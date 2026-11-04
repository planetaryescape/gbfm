CREATE TABLE editorial_oauth_revoked_grant (id text PRIMARY KEY NOT NULL, reference_id text NOT NULL, client_id text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX editorial_oauth_revoked_grant_pair ON editorial_oauth_revoked_grant(reference_id, client_id);
--> statement-breakpoint
CREATE TABLE editorial_oauth_epoch (user_id text PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE, generation text NOT NULL);
--> statement-breakpoint
CREATE TABLE rate_limit (id text PRIMARY KEY NOT NULL, key text NOT NULL UNIQUE, count integer NOT NULL, last_request integer NOT NULL);
--> statement-breakpoint
CREATE TABLE oauth_client (id text PRIMARY KEY NOT NULL, client_id text NOT NULL UNIQUE, client_secret text, client_discovery_id text, disabled integer DEFAULT 0, skip_consent integer, enable_end_session integer, subject_type text, scopes text, client_credentials_scopes text DEFAULT '[]', user_id text REFERENCES user(id) ON DELETE CASCADE, created_at integer, updated_at integer, name text, uri text, icon text, contacts text, tos text, policy text, software_id text, software_version text, software_statement text, redirect_uris text NOT NULL, post_logout_redirect_uris text, backchannel_logout_uri text, backchannel_logout_session_required integer, token_endpoint_auth_method text, application_type text, jwks text, jwks_uri text, grant_types text, response_types text, require_pkce integer, dpop_bound_access_tokens integer DEFAULT 0, reference_id text, metadata text);
--> statement-breakpoint
CREATE TABLE oauth_resource (id text PRIMARY KEY NOT NULL, identifier text NOT NULL UNIQUE, name text NOT NULL, access_token_ttl integer, refresh_token_ttl integer, signing_algorithm text, signing_key_id text, allowed_scopes text, custom_claims text, dpop_bound_access_tokens_required integer DEFAULT 0, disabled integer DEFAULT 0, created_at integer, updated_at integer, policy_version integer DEFAULT 1, metadata text);
--> statement-breakpoint
CREATE TABLE oauth_client_resource (id text PRIMARY KEY NOT NULL, client_id text NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE, resource_id text NOT NULL REFERENCES oauth_resource(identifier) ON DELETE CASCADE, metadata text, created_at integer);
--> statement-breakpoint
CREATE UNIQUE INDEX oauth_client_resource_pair ON oauth_client_resource(client_id, resource_id);
--> statement-breakpoint
CREATE TABLE oauth_client_assertion (id text PRIMARY KEY NOT NULL, expires_at integer NOT NULL);
--> statement-breakpoint
CREATE TABLE oauth_consent (id text PRIMARY KEY NOT NULL, client_id text NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE, user_id text REFERENCES user(id) ON DELETE CASCADE, reference_id text, resources text, requested_user_info_claims text, scopes text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);
--> statement-breakpoint
CREATE TABLE oauth_refresh_token (id text PRIMARY KEY NOT NULL, token text NOT NULL UNIQUE, client_id text NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE, session_id text REFERENCES session(id) ON DELETE SET NULL, reference_id text, authorization_code_id text, resources text, requested_user_info_claims text, expires_at integer NOT NULL, created_at integer NOT NULL, revoked integer, confirmation text, scopes text NOT NULL, user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE, rotated_at integer, rotation_replay_response text, rotation_replay_expires_at integer, auth_time integer);
--> statement-breakpoint
CREATE TABLE oauth_access_token (id text PRIMARY KEY NOT NULL, token text NOT NULL UNIQUE, client_id text NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE, session_id text REFERENCES session(id) ON DELETE SET NULL, reference_id text, authorization_code_id text, resources text, requested_user_info_claims text, expires_at integer NOT NULL, created_at integer NOT NULL, revoked integer, confirmation text, scopes text NOT NULL, user_id text REFERENCES user(id) ON DELETE CASCADE, refresh_id text REFERENCES oauth_refresh_token(id) ON DELETE CASCADE);
--> statement-breakpoint
CREATE INDEX oauth_consent_user_client ON oauth_consent(user_id, client_id);
--> statement-breakpoint
CREATE INDEX oauth_refresh_token_user_client ON oauth_refresh_token(user_id, client_id);
--> statement-breakpoint
CREATE INDEX oauth_access_token_user_client ON oauth_access_token(user_id, client_id);
--> statement-breakpoint
CREATE INDEX oauth_refresh_token_code ON oauth_refresh_token(authorization_code_id);
--> statement-breakpoint
CREATE INDEX oauth_access_token_code ON oauth_access_token(authorization_code_id);
--> statement-breakpoint
CREATE TRIGGER editorial_oauth_refresh_live BEFORE INSERT ON oauth_refresh_token
WHEN NEW.reference_id IS NULL OR EXISTS (SELECT 1 FROM editorial_oauth_revoked_grant WHERE reference_id = NEW.reference_id AND client_id = NEW.client_id)
BEGIN SELECT RAISE(ABORT, 'Editorial grant revoked'); END;
--> statement-breakpoint
CREATE TRIGGER editorial_oauth_access_live BEFORE INSERT ON oauth_access_token
WHEN NEW.reference_id IS NULL OR EXISTS (SELECT 1 FROM editorial_oauth_revoked_grant WHERE reference_id = NEW.reference_id AND client_id = NEW.client_id)
BEGIN SELECT RAISE(ABORT, 'Editorial grant revoked'); END;
