ALTER TABLE tardy_posts ADD COLUMN article jsonb;
ALTER TABLE tardy_posts ADD CONSTRAINT article_shape CHECK (
    article IS NULL OR (
        jsonb_typeof(article) = 'object'
        AND article ?& ARRAY['title','markdown']
        AND jsonb_typeof(article->'title') = 'string'
        AND jsonb_typeof(article->'markdown') = 'string'
        AND length(btrim(article->>'title')) BETWEEN 1 AND 200
        AND octet_length(article->>'markdown') BETWEEN 1 AND 200000
    )
);
