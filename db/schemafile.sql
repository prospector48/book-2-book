-- =========================================================
-- BookLoop - Book Exchange Application
-- PostgreSQL / Supabase - FULL UPDATED SCHEMA (schemafile.sql)
--
-- Use this file for a FRESH database.
-- If your old schema.sql is already running, run the update
-- script from the previous message instead (do not run both).
-- =========================================================

-- 1. USER TABLE
-- Login (own code, not Supabase Auth) + location
CREATE TABLE public."user" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'USER',
    phone VARCHAR(20),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_user_role
        CHECK (role IN ('USER', 'ADMIN')),

    -- only bcrypt / argon2 hashes are accepted, never plain text
    CONSTRAINT chk_password_hash_format
        CHECK (password_hash ~ '^\$(2[aby]\$|argon2(id|i|d)\$)'),

    CONSTRAINT chk_user_latitude
        CHECK (latitude BETWEEN -90 AND 90),

    CONSTRAINT chk_user_longitude
        CHECK (longitude BETWEEN -180 AND 180)
);

-- Case-insensitive unique email (Ali@x.com = ali@x.com)
CREATE UNIQUE INDEX uq_user_email_lower ON public."user" (lower(email));


-- 2. BOOK TABLE
CREATE TABLE public.book (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    author VARCHAR(150) NOT NULL,
    isbn VARCHAR(20),
    category VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 3. LISTING TABLE
-- Connects users with books they own (OFFER) or want (WANTED)
CREATE TABLE public.listing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    book_id UUID NOT NULL,
    listing_type VARCHAR(10) NOT NULL
        CHECK (listing_type IN ('OFFER', 'WANTED')),
    condition VARCHAR(30),
    photo_url TEXT,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_listing_user
        FOREIGN KEY (user_id)
        REFERENCES public."user"(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_listing_book
        FOREIGN KEY (book_id)
        REFERENCES public.book(id)
        ON DELETE RESTRICT
);


-- 4. EXCHANGE TABLE (swap requests)
CREATE TABLE public.exchange (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL,
    receiver_id UUID NOT NULL,
    requested_listing_id UUID NOT NULL,
    offered_listing_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'COMPLETED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_exchange_requester
        FOREIGN KEY (requester_id)
        REFERENCES public."user"(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_exchange_receiver
        FOREIGN KEY (receiver_id)
        REFERENCES public."user"(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_exchange_requested_listing
        FOREIGN KEY (requested_listing_id)
        REFERENCES public.listing(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_exchange_offered_listing
        FOREIGN KEY (offered_listing_id)
        REFERENCES public.listing(id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_different_users
        CHECK (requester_id <> receiver_id),

    CONSTRAINT chk_different_listings
        CHECK (requested_listing_id <> offered_listing_id)
);


-- 5. MESSAGE TABLE
CREATE TABLE public.message (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL,
    exchange_id UUID NOT NULL,
    message_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_message_sender
        FOREIGN KEY (sender_id)
        REFERENCES public."user"(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_message_exchange
        FOREIGN KEY (exchange_id)
        REFERENCES public.exchange(id)
        ON DELETE CASCADE
);


-- 6. REVIEW TABLE
CREATE TABLE public.review (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exchange_id UUID NOT NULL,
    reviewer_id UUID NOT NULL,
    reviewed_user_id UUID NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_review_exchange
        FOREIGN KEY (exchange_id)
        REFERENCES public.exchange(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_review_reviewer
        FOREIGN KEY (reviewer_id)
        REFERENCES public."user"(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_review_reviewed_user
        FOREIGN KEY (reviewed_user_id)
        REFERENCES public."user"(id)
        ON DELETE CASCADE,

    CONSTRAINT chk_different_review_users
        CHECK (reviewer_id <> reviewed_user_id),

    CONSTRAINT unique_review_per_user_per_exchange
        UNIQUE (exchange_id, reviewer_id)
);


-- =========================================================
-- INDEXES (my books, nearby search, incoming/outgoing swaps)
-- =========================================================
CREATE INDEX idx_listing_user               ON public.listing  (user_id);
CREATE INDEX idx_listing_book               ON public.listing  (book_id);
CREATE INDEX idx_listing_type_available     ON public.listing  (listing_type, is_available);
CREATE INDEX idx_exchange_requester_status  ON public.exchange (requester_id, status);
CREATE INDEX idx_exchange_receiver_status   ON public.exchange (receiver_id, status);
CREATE INDEX idx_exchange_requested_listing ON public.exchange (requested_listing_id);
CREATE INDEX idx_exchange_offered_listing   ON public.exchange (offered_listing_id);
CREATE INDEX idx_message_exchange           ON public.message  (exchange_id);
CREATE INDEX idx_review_reviewed_user       ON public.review   (reviewed_user_id);


-- =========================================================
-- NEARBY SEARCH FUNCTION (haversine distance, no extension needed)
-- Available OFFER listings matching title/author, nearest first.
-- =========================================================
CREATE OR REPLACE FUNCTION public.find_nearby_offers(
    p_search       TEXT,
    p_lat          DOUBLE PRECISION,
    p_lng          DOUBLE PRECISION,
    p_max_km       DOUBLE PRECISION DEFAULT 50,
    p_exclude_user UUID DEFAULT NULL
)
RETURNS TABLE (
    listing_id  UUID,
    book_id     UUID,
    title       TEXT,
    author      TEXT,
    condition   TEXT,
    photo_url   TEXT,
    owner_id    UUID,
    owner_name  TEXT,
    distance_km DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
    SELECT t.l_id, t.b_id, t.title, t.author, t.condition, t.photo_url,
           t.u_id, t.full_name, t.dist
    FROM (
        SELECT
            l.id AS l_id,
            b.id AS b_id,
            b.title::TEXT AS title,
            b.author::TEXT AS author,
            l.condition::TEXT AS condition,
            l.photo_url,
            u.id AS u_id,
            u.full_name::TEXT AS full_name,
            6371 * 2 * asin(sqrt(least(1,
                power(sin(radians(u.latitude - p_lat) / 2), 2) +
                cos(radians(p_lat)) * cos(radians(u.latitude)) *
                power(sin(radians(u.longitude - p_lng) / 2), 2)
            ))) AS dist
        FROM public.listing l
        JOIN public.book b   ON b.id = l.book_id
        JOIN public."user" u ON u.id = l.user_id
        WHERE l.listing_type = 'OFFER'
          AND l.is_available
          AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
          AND (b.title ILIKE '%' || p_search || '%' OR b.author ILIKE '%' || p_search || '%')
          AND (p_exclude_user IS NULL OR u.id <> p_exclude_user)
    ) t
    WHERE t.dist <= p_max_km
    ORDER BY t.dist;
$$;


-- =========================================================
-- ROW LEVEL SECURITY
-- On with no policies: the public Supabase API (anon key) cannot read
-- anything. Your backend (service role / direct connection) bypasses RLS.
-- =========================================================
ALTER TABLE public."user"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review   ENABLE ROW LEVEL SECURITY;
