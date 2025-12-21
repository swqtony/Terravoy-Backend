SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict R777KTjARTeKS0qcBzGi4dfj8eAwIVb8sxrERznwOQnQwODPTckMdSX86uLQ7g0

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."users" ("instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at", "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change", "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data", "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at", "phone_change", "phone_change_token", "phone_change_sent_at", "email_change_token_current", "email_change_confirm_status", "banned_until", "reauthentication_token", "reauthentication_sent_at", "is_sso_user", "deleted_at", "is_anonymous") VALUES
	('00000000-0000-0000-0000-000000000000', '0a80cb33-e305-41e9-93ef-db157dd79127', 'authenticated', 'authenticated', '69306a56af4f482042c7884c@lc.terralink.local', '$2a$10$VtkGozgeWai/2MFBVFdhDeVnDmfuYYKX7jOGyJ50/rQxvCSP3fUxO', '2025-12-13 05:42:33.358203+00', NULL, '', NULL, '', NULL, '', '', NULL, '2025-12-13 12:57:34.864835+00', '{"provider": "email", "providers": ["email"], "leancloudUserId": "69306a56af4f482042c7884c"}', '{"email_verified": true, "leancloudUserId": "69306a56af4f482042c7884c"}', NULL, '2025-12-13 05:42:33.340846+00', '2025-12-13 12:57:37.210194+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', 'authenticated', 'authenticated', '69305aa5daee5f72f2665da8@lc.terralink.local', '$2a$10$.kc4wD7iV19v11IS8pGvjuMiX8VtgxWB.10k/BdbSFBdFUSOIMHd.', '2025-12-12 15:22:28.099171+00', NULL, '', NULL, '', NULL, '', '', NULL, '2025-12-13 12:59:49.883681+00', '{"provider": "email", "providers": ["email"], "leancloudUserId": "69305aa5daee5f72f2665da8"}', '{"email_verified": true, "leancloudUserId": "69305aa5daee5f72f2665da8"}', NULL, '2025-12-12 15:22:28.061223+00', '2025-12-13 12:59:55.983086+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', '7e313924-3fb3-44d6-b94d-03f753104c15', 'authenticated', 'authenticated', '69305aa5daee5f72f2665da8@leanuser.terralink', '$2a$10$iEA3w96egIWhEYMRhSU7jeunORWbgU6e2/wsCMEa93nYZrgxvwhI.', '2025-12-12 12:53:02.025416+00', NULL, '', NULL, '', NULL, '', '', NULL, '2025-12-12 12:53:02.362402+00', '{"provider": "email", "providers": ["email"], "leancloudUserId": "69305aa5daee5f72f2665da8"}', '{"email_verified": true, "leancloudUserId": "69305aa5daee5f72f2665da8"}', NULL, '2025-12-12 12:53:01.949606+00', '2025-12-12 12:53:03.443836+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', 'd8fb31d5-36e7-4bf1-8d7d-966666328dc2', 'authenticated', 'authenticated', '693d4f02171b217b0e209730@lc.terralink.local', '$2a$10$YXa7ujgFyTJhzBZwgGEijep/7.rmbx/20JV1Ee8xqg7nk40esEdU6', '2025-12-13 11:33:25.396753+00', NULL, '', NULL, '', NULL, '', '', NULL, '2025-12-13 11:33:25.766901+00', '{"provider": "email", "providers": ["email"], "leancloudUserId": "693d4f02171b217b0e209730"}', '{"email_verified": true, "leancloudUserId": "693d4f02171b217b0e209730"}', NULL, '2025-12-13 11:33:25.38126+00', '2025-12-13 11:33:27.450426+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', '0de22fba-a75c-49d7-88f2-d901ab4811e7', 'authenticated', 'authenticated', '693d4f0005564e3126d0a289@lc.terralink.local', '$2a$10$iy/micT8pwZqg95ehe1w9e9ctR6TrqiBj6sC6SN2TrLuH5Lm07RJW', '2025-12-13 11:33:25.368759+00', NULL, '', NULL, '', NULL, '', '', NULL, '2025-12-13 11:33:25.762563+00', '{"provider": "email", "providers": ["email"], "leancloudUserId": "693d4f0005564e3126d0a289"}', '{"email_verified": true, "leancloudUserId": "693d4f0005564e3126d0a289"}', NULL, '2025-12-13 11:33:25.330747+00', '2025-12-13 12:39:49.4828+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false);


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."identities" ("provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at", "id") VALUES
	('7e313924-3fb3-44d6-b94d-03f753104c15', '7e313924-3fb3-44d6-b94d-03f753104c15', '{"sub": "7e313924-3fb3-44d6-b94d-03f753104c15", "email": "69305aa5daee5f72f2665da8@leanuser.terralink", "email_verified": false, "phone_verified": false}', 'email', '2025-12-12 12:53:01.997041+00', '2025-12-12 12:53:01.998299+00', '2025-12-12 12:53:01.998299+00', '010707bf-510a-4b5a-82fe-770191c86c41'),
	('cc247b5f-c9b5-42bf-a55a-ec96593b28e5', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '{"sub": "cc247b5f-c9b5-42bf-a55a-ec96593b28e5", "email": "69305aa5daee5f72f2665da8@lc.terralink.local", "email_verified": false, "phone_verified": false}', 'email', '2025-12-12 15:22:28.084314+00', '2025-12-12 15:22:28.085565+00', '2025-12-12 15:22:28.085565+00', 'ef7f2f0d-8f24-4cea-873d-17fa9442997b'),
	('0a80cb33-e305-41e9-93ef-db157dd79127', '0a80cb33-e305-41e9-93ef-db157dd79127', '{"sub": "0a80cb33-e305-41e9-93ef-db157dd79127", "email": "69306a56af4f482042c7884c@lc.terralink.local", "email_verified": false, "phone_verified": false}', 'email', '2025-12-13 05:42:33.352896+00', '2025-12-13 05:42:33.35297+00', '2025-12-13 05:42:33.35297+00', '85ae576f-6f20-4358-a76c-853c1210cea8'),
	('0de22fba-a75c-49d7-88f2-d901ab4811e7', '0de22fba-a75c-49d7-88f2-d901ab4811e7', '{"sub": "0de22fba-a75c-49d7-88f2-d901ab4811e7", "email": "693d4f0005564e3126d0a289@lc.terralink.local", "email_verified": false, "phone_verified": false}', 'email', '2025-12-13 11:33:25.351605+00', '2025-12-13 11:33:25.352306+00', '2025-12-13 11:33:25.352306+00', 'a0be54fc-f96c-4361-8739-a7efed621908'),
	('d8fb31d5-36e7-4bf1-8d7d-966666328dc2', 'd8fb31d5-36e7-4bf1-8d7d-966666328dc2', '{"sub": "d8fb31d5-36e7-4bf1-8d7d-966666328dc2", "email": "693d4f02171b217b0e209730@lc.terralink.local", "email_verified": false, "phone_verified": false}', 'email', '2025-12-13 11:33:25.385916+00', '2025-12-13 11:33:25.38597+00', '2025-12-13 11:33:25.38597+00', 'e6d9777f-7b4e-4fac-ac1b-e6e112cb00ef');


--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."sessions" ("id", "user_id", "created_at", "updated_at", "factor_id", "aal", "not_after", "refreshed_at", "user_agent", "ip", "tag", "oauth_client_id", "refresh_token_hmac_key", "refresh_token_counter", "scopes") VALUES
	('7b66e3b5-8934-4ab2-8ce2-851e65f4b3fe', '7e313924-3fb3-44d6-b94d-03f753104c15', '2025-12-12 12:53:02.363148+00', '2025-12-12 12:53:03.44742+00', NULL, 'aal1', NULL, '2025-12-12 12:53:03.447324', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('d745ad42-41cd-4a22-be08-31ec4a54865c', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '2025-12-12 15:22:28.363035+00', '2025-12-12 15:22:30.147957+00', NULL, 'aal1', NULL, '2025-12-12 15:22:30.147861', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('7adae2a0-9317-4d96-960f-e061c9074bf3', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '2025-12-12 15:49:54.366269+00', '2025-12-12 15:49:55.430653+00', NULL, 'aal1', NULL, '2025-12-12 15:49:55.430554', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('4a772fdc-3ded-4918-b329-cc1bd37bcfb0', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '2025-12-12 16:59:12.133652+00', '2025-12-12 16:59:14.426265+00', NULL, 'aal1', NULL, '2025-12-12 16:59:14.425543', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('b265a7ae-2b48-45a9-be12-c9319bc3d245', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '2025-12-13 03:12:21.89784+00', '2025-12-13 04:35:01.687084+00', NULL, 'aal1', NULL, '2025-12-13 04:35:01.686949', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('f374a36b-4295-48e7-88ae-f92c143376ab', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '2025-12-13 04:36:48.688045+00', '2025-12-13 04:36:53.055223+00', NULL, 'aal1', NULL, '2025-12-13 04:36:53.055108', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('7eda7bd6-11e1-4b29-91a7-eb342e594864', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '2025-12-13 04:55:05.976578+00', '2025-12-13 04:55:07.182859+00', NULL, 'aal1', NULL, '2025-12-13 04:55:07.182761', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('213c8253-a8f0-45ca-a7ea-102811c206b3', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '2025-12-13 04:56:28.228777+00', '2025-12-13 04:56:29.316753+00', NULL, 'aal1', NULL, '2025-12-13 04:56:29.316645', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('1cbcacf7-5bda-40c7-b58a-56c1ce395ef6', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '2025-12-13 05:06:50.959235+00', '2025-12-13 05:06:51.720516+00', NULL, 'aal1', NULL, '2025-12-13 05:06:51.720423', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('aac6845d-642c-4f82-b348-6dbc36f14d26', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '2025-12-13 05:15:04.806142+00', '2025-12-13 05:15:05.621703+00', NULL, 'aal1', NULL, '2025-12-13 05:15:05.621587', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('5cd35938-92e9-4b77-b62f-459a5467af1e', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '2025-12-13 05:28:58.351768+00', '2025-12-13 05:28:59.318269+00', NULL, 'aal1', NULL, '2025-12-13 05:28:59.318176', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('19134e67-1afd-41d4-8f08-6d85371a16af', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '2025-12-13 05:38:47.8058+00', '2025-12-13 05:38:49.362999+00', NULL, 'aal1', NULL, '2025-12-13 05:38:49.362386', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('93bd0a3c-f893-4774-b472-249056df6080', '0a80cb33-e305-41e9-93ef-db157dd79127', '2025-12-13 05:42:33.733034+00', '2025-12-13 05:42:34.725583+00', NULL, 'aal1', NULL, '2025-12-13 05:42:34.725486', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('026d5c3f-9761-4f4e-8810-9191c63104eb', 'd8fb31d5-36e7-4bf1-8d7d-966666328dc2', '2025-12-13 11:33:25.767027+00', '2025-12-13 11:33:27.451485+00', NULL, 'aal1', NULL, '2025-12-13 11:33:27.451396', 'Dart/3.10 (dart:io)', '114.245.85.3', NULL, NULL, NULL, NULL, NULL),
	('2724ba8a-c880-4adb-a301-9b0a25007594', '0de22fba-a75c-49d7-88f2-d901ab4811e7', '2025-12-13 11:33:25.762677+00', '2025-12-13 12:39:49.49415+00', NULL, 'aal1', NULL, '2025-12-13 12:39:49.493513', 'Dart/3.10 (dart:io)', '114.245.85.3', NULL, NULL, NULL, NULL, NULL),
	('a1740fb0-465c-4774-a4da-bfeea820efff', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '2025-12-13 12:55:12.037507+00', '2025-12-13 12:55:15.275264+00', NULL, 'aal1', NULL, '2025-12-13 12:55:15.275155', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('9005cdc7-4fab-491c-94fa-8b464003324d', '0a80cb33-e305-41e9-93ef-db157dd79127', '2025-12-13 12:57:34.864932+00', '2025-12-13 12:57:37.212606+00', NULL, 'aal1', NULL, '2025-12-13 12:57:37.211926', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL),
	('7c18fd2c-2dae-4ac5-87f8-e1a3aefaf12e', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', '2025-12-13 12:59:49.883779+00', '2025-12-13 12:59:55.984077+00', NULL, 'aal1', NULL, '2025-12-13 12:59:55.98397', 'Dart/3.10 (dart:io)', '183.241.215.47', NULL, NULL, NULL, NULL, NULL);


--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."mfa_amr_claims" ("session_id", "created_at", "updated_at", "authentication_method", "id") VALUES
	('7b66e3b5-8934-4ab2-8ce2-851e65f4b3fe', '2025-12-12 12:53:02.425958+00', '2025-12-12 12:53:02.425958+00', 'password', 'a41280f8-928a-44da-bd6a-710ad73f7834'),
	('d745ad42-41cd-4a22-be08-31ec4a54865c', '2025-12-12 15:22:28.384921+00', '2025-12-12 15:22:28.384921+00', 'password', '352645a0-fa18-4dc4-b675-e09ce9c3ce77'),
	('7adae2a0-9317-4d96-960f-e061c9074bf3', '2025-12-12 15:49:54.389007+00', '2025-12-12 15:49:54.389007+00', 'password', '438d7f9b-357a-4324-8e06-a820cdd0dcac'),
	('4a772fdc-3ded-4918-b329-cc1bd37bcfb0', '2025-12-12 16:59:12.224765+00', '2025-12-12 16:59:12.224765+00', 'password', 'ed46a929-15e0-4d76-a42c-8b6b2d4a713d'),
	('b265a7ae-2b48-45a9-be12-c9319bc3d245', '2025-12-13 03:12:21.993542+00', '2025-12-13 03:12:21.993542+00', 'password', '094191bd-72f2-4b49-860a-61354f564dbc'),
	('f374a36b-4295-48e7-88ae-f92c143376ab', '2025-12-13 04:36:48.696843+00', '2025-12-13 04:36:48.696843+00', 'password', '13316d07-f3c4-4d3b-9fe7-84a0c544304e'),
	('7eda7bd6-11e1-4b29-91a7-eb342e594864', '2025-12-13 04:55:06.033484+00', '2025-12-13 04:55:06.033484+00', 'password', 'b4541b6f-a10a-4416-8ad4-4685b0c11a7a'),
	('213c8253-a8f0-45ca-a7ea-102811c206b3', '2025-12-13 04:56:28.232885+00', '2025-12-13 04:56:28.232885+00', 'password', '21db1149-dd3a-44cc-be79-e8be9d9e3595'),
	('1cbcacf7-5bda-40c7-b58a-56c1ce395ef6', '2025-12-13 05:06:50.975843+00', '2025-12-13 05:06:50.975843+00', 'password', '91d40a5b-788b-4f98-8187-a46a0a05d2ab'),
	('aac6845d-642c-4f82-b348-6dbc36f14d26', '2025-12-13 05:15:04.848783+00', '2025-12-13 05:15:04.848783+00', 'password', '70235f65-c0f0-4c1f-ac0b-361b93bb81f8'),
	('5cd35938-92e9-4b77-b62f-459a5467af1e', '2025-12-13 05:28:58.366666+00', '2025-12-13 05:28:58.366666+00', 'password', '338dcf86-21d1-4b82-a68a-ac745b48c166'),
	('19134e67-1afd-41d4-8f08-6d85371a16af', '2025-12-13 05:38:47.815685+00', '2025-12-13 05:38:47.815685+00', 'password', 'e2215f90-1e13-4477-a23a-ceb729fb9cce'),
	('93bd0a3c-f893-4774-b472-249056df6080', '2025-12-13 05:42:33.73922+00', '2025-12-13 05:42:33.73922+00', 'password', 'ea726ffd-cc8e-4d51-a308-35de3760800d'),
	('026d5c3f-9761-4f4e-8810-9191c63104eb', '2025-12-13 11:33:25.81763+00', '2025-12-13 11:33:25.81763+00', 'password', 'fffb95c3-d155-4223-b1e6-92712a8bfa0e'),
	('2724ba8a-c880-4adb-a301-9b0a25007594', '2025-12-13 11:33:25.818801+00', '2025-12-13 11:33:25.818801+00', 'password', '97923ceb-b88f-4692-82ac-88f182511d16'),
	('a1740fb0-465c-4774-a4da-bfeea820efff', '2025-12-13 12:55:12.07389+00', '2025-12-13 12:55:12.07389+00', 'password', '3ec08c27-479e-4dea-a100-32bee06c1fa3'),
	('9005cdc7-4fab-491c-94fa-8b464003324d', '2025-12-13 12:57:34.871168+00', '2025-12-13 12:57:34.871168+00', 'password', '489e293c-8287-4f6e-bd58-1c93bd3da929'),
	('7c18fd2c-2dae-4ac5-87f8-e1a3aefaf12e', '2025-12-13 12:59:49.887377+00', '2025-12-13 12:59:49.887377+00', 'password', '50882c83-8ae1-4758-bcb0-d8c079e38514');


--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_client_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."refresh_tokens" ("instance_id", "id", "token", "user_id", "revoked", "created_at", "updated_at", "parent", "session_id") VALUES
	('00000000-0000-0000-0000-000000000000', 1, 's7xbbqiujbtd', '7e313924-3fb3-44d6-b94d-03f753104c15', true, '2025-12-12 12:53:02.396182+00', '2025-12-12 12:53:03.436162+00', NULL, '7b66e3b5-8934-4ab2-8ce2-851e65f4b3fe'),
	('00000000-0000-0000-0000-000000000000', 2, '42emqegktluc', '7e313924-3fb3-44d6-b94d-03f753104c15', false, '2025-12-12 12:53:03.439389+00', '2025-12-12 12:53:03.439389+00', 's7xbbqiujbtd', '7b66e3b5-8934-4ab2-8ce2-851e65f4b3fe'),
	('00000000-0000-0000-0000-000000000000', 3, 'zswxpryxoi46', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-12 15:22:28.374504+00', '2025-12-12 15:22:30.140661+00', NULL, 'd745ad42-41cd-4a22-be08-31ec4a54865c'),
	('00000000-0000-0000-0000-000000000000', 4, 'dimxhgzulfbl', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', false, '2025-12-12 15:22:30.143657+00', '2025-12-12 15:22:30.143657+00', 'zswxpryxoi46', 'd745ad42-41cd-4a22-be08-31ec4a54865c'),
	('00000000-0000-0000-0000-000000000000', 5, '5mrafhw4ks5p', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-12 15:49:54.379953+00', '2025-12-12 15:49:55.427654+00', NULL, '7adae2a0-9317-4d96-960f-e061c9074bf3'),
	('00000000-0000-0000-0000-000000000000', 6, 'wjuaoi2n5l4c', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', false, '2025-12-12 15:49:55.428325+00', '2025-12-12 15:49:55.428325+00', '5mrafhw4ks5p', '7adae2a0-9317-4d96-960f-e061c9074bf3'),
	('00000000-0000-0000-0000-000000000000', 7, '6i2blvwj2diw', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-12 16:59:12.182656+00', '2025-12-12 16:59:14.409538+00', NULL, '4a772fdc-3ded-4918-b329-cc1bd37bcfb0'),
	('00000000-0000-0000-0000-000000000000', 8, 't22wtz3m5f3d', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', false, '2025-12-12 16:59:14.413409+00', '2025-12-12 16:59:14.413409+00', '6i2blvwj2diw', '4a772fdc-3ded-4918-b329-cc1bd37bcfb0'),
	('00000000-0000-0000-0000-000000000000', 9, 'pu4uuh5n6qei', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-13 03:12:21.949496+00', '2025-12-13 03:12:23.921651+00', NULL, 'b265a7ae-2b48-45a9-be12-c9319bc3d245'),
	('00000000-0000-0000-0000-000000000000', 10, 'xdx5fknh5j62', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-13 03:12:23.925487+00', '2025-12-13 04:35:01.663431+00', 'pu4uuh5n6qei', 'b265a7ae-2b48-45a9-be12-c9319bc3d245'),
	('00000000-0000-0000-0000-000000000000', 11, '2j3fmdavsy7f', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', false, '2025-12-13 04:35:01.675695+00', '2025-12-13 04:35:01.675695+00', 'xdx5fknh5j62', 'b265a7ae-2b48-45a9-be12-c9319bc3d245'),
	('00000000-0000-0000-0000-000000000000', 12, 'gnmv2cgtf7lw', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-13 04:36:48.694804+00', '2025-12-13 04:36:53.050257+00', NULL, 'f374a36b-4295-48e7-88ae-f92c143376ab'),
	('00000000-0000-0000-0000-000000000000', 13, 'i7e4tcphsx37', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', false, '2025-12-13 04:36:53.050919+00', '2025-12-13 04:36:53.050919+00', 'gnmv2cgtf7lw', 'f374a36b-4295-48e7-88ae-f92c143376ab'),
	('00000000-0000-0000-0000-000000000000', 14, '5bibaqeaneox', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-13 04:55:06.00657+00', '2025-12-13 04:55:07.176221+00', NULL, '7eda7bd6-11e1-4b29-91a7-eb342e594864'),
	('00000000-0000-0000-0000-000000000000', 15, 'vryu3rsbabot', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', false, '2025-12-13 04:55:07.177567+00', '2025-12-13 04:55:07.177567+00', '5bibaqeaneox', '7eda7bd6-11e1-4b29-91a7-eb342e594864'),
	('00000000-0000-0000-0000-000000000000', 16, '3mzk3nghfj6y', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-13 04:56:28.230658+00', '2025-12-13 04:56:29.311985+00', NULL, '213c8253-a8f0-45ca-a7ea-102811c206b3'),
	('00000000-0000-0000-0000-000000000000', 17, 'meetrmgr55j2', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', false, '2025-12-13 04:56:29.313009+00', '2025-12-13 04:56:29.313009+00', '3mzk3nghfj6y', '213c8253-a8f0-45ca-a7ea-102811c206b3'),
	('00000000-0000-0000-0000-000000000000', 18, 'wspflwc3h4et', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-13 05:06:50.97044+00', '2025-12-13 05:06:51.717644+00', NULL, '1cbcacf7-5bda-40c7-b58a-56c1ce395ef6'),
	('00000000-0000-0000-0000-000000000000', 19, 'z5u2q34rap7f', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', false, '2025-12-13 05:06:51.718274+00', '2025-12-13 05:06:51.718274+00', 'wspflwc3h4et', '1cbcacf7-5bda-40c7-b58a-56c1ce395ef6'),
	('00000000-0000-0000-0000-000000000000', 20, 'ocrvsgry25zc', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-13 05:15:04.826923+00', '2025-12-13 05:15:05.615215+00', NULL, 'aac6845d-642c-4f82-b348-6dbc36f14d26'),
	('00000000-0000-0000-0000-000000000000', 21, 'blw24khit36x', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', false, '2025-12-13 05:15:05.615931+00', '2025-12-13 05:15:05.615931+00', 'ocrvsgry25zc', 'aac6845d-642c-4f82-b348-6dbc36f14d26'),
	('00000000-0000-0000-0000-000000000000', 22, 'lyqra25qp5gz', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-13 05:28:58.360528+00', '2025-12-13 05:28:59.31474+00', NULL, '5cd35938-92e9-4b77-b62f-459a5467af1e'),
	('00000000-0000-0000-0000-000000000000', 23, 'ggmg336pewui', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', false, '2025-12-13 05:28:59.3163+00', '2025-12-13 05:28:59.3163+00', 'lyqra25qp5gz', '5cd35938-92e9-4b77-b62f-459a5467af1e'),
	('00000000-0000-0000-0000-000000000000', 24, '5xbzx252ib3t', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-13 05:38:47.809613+00', '2025-12-13 05:38:49.35793+00', NULL, '19134e67-1afd-41d4-8f08-6d85371a16af'),
	('00000000-0000-0000-0000-000000000000', 25, 'rcdsdhumcmeq', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', false, '2025-12-13 05:38:49.358615+00', '2025-12-13 05:38:49.358615+00', '5xbzx252ib3t', '19134e67-1afd-41d4-8f08-6d85371a16af'),
	('00000000-0000-0000-0000-000000000000', 26, 'yaf7h6tmz3rr', '0a80cb33-e305-41e9-93ef-db157dd79127', true, '2025-12-13 05:42:33.736005+00', '2025-12-13 05:42:34.7229+00', NULL, '93bd0a3c-f893-4774-b472-249056df6080'),
	('00000000-0000-0000-0000-000000000000', 27, 'tuztjqpovsmf', '0a80cb33-e305-41e9-93ef-db157dd79127', false, '2025-12-13 05:42:34.723576+00', '2025-12-13 05:42:34.723576+00', 'yaf7h6tmz3rr', '93bd0a3c-f893-4774-b472-249056df6080'),
	('00000000-0000-0000-0000-000000000000', 28, '37fn6zefxrv4', '0de22fba-a75c-49d7-88f2-d901ab4811e7', true, '2025-12-13 11:33:25.788815+00', '2025-12-13 11:33:27.429252+00', NULL, '2724ba8a-c880-4adb-a301-9b0a25007594'),
	('00000000-0000-0000-0000-000000000000', 29, 'kjltjuevxnpn', 'd8fb31d5-36e7-4bf1-8d7d-966666328dc2', true, '2025-12-13 11:33:25.789444+00', '2025-12-13 11:33:27.448843+00', NULL, '026d5c3f-9761-4f4e-8810-9191c63104eb'),
	('00000000-0000-0000-0000-000000000000', 31, '7hm7gln2sqcr', 'd8fb31d5-36e7-4bf1-8d7d-966666328dc2', false, '2025-12-13 11:33:27.449458+00', '2025-12-13 11:33:27.449458+00', 'kjltjuevxnpn', '026d5c3f-9761-4f4e-8810-9191c63104eb'),
	('00000000-0000-0000-0000-000000000000', 30, 'sxwz5mj5iff7', '0de22fba-a75c-49d7-88f2-d901ab4811e7', true, '2025-12-13 11:33:27.434359+00', '2025-12-13 12:39:49.461438+00', '37fn6zefxrv4', '2724ba8a-c880-4adb-a301-9b0a25007594'),
	('00000000-0000-0000-0000-000000000000', 32, 'iy7x4zdc6ax3', '0de22fba-a75c-49d7-88f2-d901ab4811e7', false, '2025-12-13 12:39:49.475431+00', '2025-12-13 12:39:49.475431+00', 'sxwz5mj5iff7', '2724ba8a-c880-4adb-a301-9b0a25007594'),
	('00000000-0000-0000-0000-000000000000', 33, 'i7pf3c7wcpsc', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-13 12:55:12.062689+00', '2025-12-13 12:55:15.264557+00', NULL, 'a1740fb0-465c-4774-a4da-bfeea820efff'),
	('00000000-0000-0000-0000-000000000000', 34, 'v4jgq3tdnfeo', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', false, '2025-12-13 12:55:15.267544+00', '2025-12-13 12:55:15.267544+00', 'i7pf3c7wcpsc', 'a1740fb0-465c-4774-a4da-bfeea820efff'),
	('00000000-0000-0000-0000-000000000000', 35, '45zpk6t7hzg7', '0a80cb33-e305-41e9-93ef-db157dd79127', true, '2025-12-13 12:57:34.867809+00', '2025-12-13 12:57:37.207613+00', NULL, '9005cdc7-4fab-491c-94fa-8b464003324d'),
	('00000000-0000-0000-0000-000000000000', 36, 'tlpakekptxsq', '0a80cb33-e305-41e9-93ef-db157dd79127', false, '2025-12-13 12:57:37.208588+00', '2025-12-13 12:57:37.208588+00', '45zpk6t7hzg7', '9005cdc7-4fab-491c-94fa-8b464003324d'),
	('00000000-0000-0000-0000-000000000000', 37, 'nokhpptfsq2q', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', true, '2025-12-13 12:59:49.885483+00', '2025-12-13 12:59:55.981676+00', NULL, '7c18fd2c-2dae-4ac5-87f8-e1a3aefaf12e'),
	('00000000-0000-0000-0000-000000000000', 38, 'qjs5vdxzqqix', 'cc247b5f-c9b5-42bf-a55a-ec96593b28e5', false, '2025-12-13 12:59:55.982111+00', '2025-12-13 12:59:55.982111+00', 'nokhpptfsq2q', '7c18fd2c-2dae-4ac5-87f8-e1a3aefaf12e');


--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."profiles" ("id", "leancloud_user_id", "gender", "age", "first_language", "second_language", "home_city", "region", "created_at", "is_completed") VALUES
	('fa703716-7b53-40a7-9aae-9601b1cd399f', 'user_current', NULL, NULL, NULL, NULL, NULL, 'INTL', '2025-12-13 12:20:51.883381+00', false),
	('2b666b38-2040-42c3-bc9c-ea1daca864f6', '69306a56af4f482042c7884c', 'female', 30, 'en', 'en', 'beijing', 'INTL', '2025-12-13 05:42:32.259505+00', true),
	('361c0bc7-03af-4829-8c1b-6faa2ef0b678', '69305aa5daee5f72f2665da8', 'male', 30, 'en', 'en', 'beijing', 'INTL', '2025-12-13 05:38:46.804545+00', true),
	('a98dc093-b9d5-40e8-a2fd-ce4cb352c488', '693d4f0005564e3126d0a289', 'other', 30, 'en', 'en', 'beijing', 'INTL', '2025-12-13 11:33:23.223656+00', true),
	('81032477-004a-42b4-bba4-e19eece536a1', '693d4f02171b217b0e209730', 'other', 30, 'en', 'en', 'beijing', 'INTL', '2025-12-13 11:33:24.054848+00', true);


--
-- Data for Name: trip_cards; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."trip_cards" ("id", "profile_id", "destination_city", "destination_country", "start_date", "end_date", "created_at") VALUES
	('07eb8de8-f3c4-4fde-86a5-53b87d7c3e43', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', 'BJ', NULL, '2025-12-14', '2025-12-16', '2025-12-13 05:39:10.099572+00'),
	('3c5659f1-2c45-4766-a5f8-58e7e819ee75', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', 'BJ', NULL, '2025-12-14', '2025-12-16', '2025-12-13 05:41:40.046175+00'),
	('d3c4d41a-851c-4d09-b0cf-4b08486c8611', '2b666b38-2040-42c3-bc9c-ea1daca864f6', 'BJ', NULL, '2025-12-14', '2025-12-16', '2025-12-13 05:42:56.761501+00'),
	('dbef00a8-e0c9-4786-99d2-037202fccac5', 'a98dc093-b9d5-40e8-a2fd-ce4cb352c488', 'beijing', NULL, '2025-12-14', '2025-12-15', '2025-12-13 11:34:37.69805+00'),
	('f8d0fe3d-536e-459c-93c6-b46cf15cf864', '81032477-004a-42b4-bba4-e19eece536a1', 'beijing', NULL, '2025-12-14', '2025-12-15', '2025-12-13 11:34:39.036985+00'),
	('59a06002-0deb-45ba-a128-1028302056f1', 'a98dc093-b9d5-40e8-a2fd-ce4cb352c488', 'beijing', NULL, '2025-12-14', '2025-12-15', '2025-12-13 11:35:16.242903+00'),
	('725db07d-eb81-4854-99df-b93aaea5a1a1', '81032477-004a-42b4-bba4-e19eece536a1', 'beijing', NULL, '2025-12-14', '2025-12-15', '2025-12-13 11:35:28.35867+00'),
	('80a44aa5-a6e0-404f-865a-c2ffec3b94f1', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', 'beijing', NULL, '2025-12-18', '2025-12-21', '2025-12-13 12:58:46.82996+00'),
	('3fbeab85-24f7-4a26-8ca7-e02a92518ddc', '2b666b38-2040-42c3-bc9c-ea1daca864f6', 'BJ', NULL, '2025-12-18', '2025-12-21', '2025-12-13 12:58:48.962264+00'),
	('5bc08896-4f02-42ef-a3f0-64840bf561d2', '2b666b38-2040-42c3-bc9c-ea1daca864f6', 'BJ', NULL, '2025-12-18', '2025-12-21', '2025-12-13 13:00:17.735825+00'),
	('d1a1921a-c3ba-484a-8018-93aac68d17b6', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', 'BJ', NULL, '2025-12-18', '2025-12-21', '2025-12-13 13:00:19.773956+00'),
	('5581d54c-6c1a-4cd7-9e9d-1c66defa37cb', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', 'BJ', NULL, '2025-12-18', '2025-12-21', '2025-12-13 13:00:44.513392+00'),
	('345e0990-5003-4d47-9b27-7ef9a7829eff', '2b666b38-2040-42c3-bc9c-ea1daca864f6', 'BJ', NULL, '2025-12-14', '2025-12-16', '2025-12-13 13:01:06.81667+00'),
	('8c813d96-9667-4496-8034-4d994761011c', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', 'BJ', NULL, '2025-12-14', '2025-12-16', '2025-12-13 13:01:07.906145+00'),
	('73503355-ca5e-4180-ae9e-464f1528e2a1', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', 'BJ', NULL, '2025-12-18', '2025-12-20', '2025-12-13 13:01:34.581978+00'),
	('b852e635-628f-4fbf-97d9-e773d1c18dcc', '2b666b38-2040-42c3-bc9c-ea1daca864f6', 'BJ', NULL, '2025-12-18', '2025-12-20', '2025-12-13 13:01:35.723189+00');


--
-- Data for Name: match_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."match_requests" ("id", "profile_id", "trip_card_id", "preferred_gender", "preferred_age_min", "preferred_age_max", "preferred_languages", "city_scope_mode", "status", "created_at") VALUES
	('88859bd3-9149-458d-a79d-16abd3cc564a', 'a98dc093-b9d5-40e8-a2fd-ce4cb352c488', 'dbef00a8-e0c9-4786-99d2-037202fccac5', NULL, NULL, NULL, NULL, 'Strict', 'matched', '2025-12-13 11:34:40.501562+00'),
	('317f1381-b9db-45df-8507-533670e415fa', '81032477-004a-42b4-bba4-e19eece536a1', 'f8d0fe3d-536e-459c-93c6-b46cf15cf864', NULL, NULL, NULL, NULL, 'Strict', 'matched', '2025-12-13 11:34:40.941591+00'),
	('cdb839fd-1f71-4285-af40-89de5261c80b', 'a98dc093-b9d5-40e8-a2fd-ce4cb352c488', '59a06002-0deb-45ba-a128-1028302056f1', NULL, NULL, NULL, NULL, 'Strict', 'matched', '2025-12-13 11:35:18.53813+00'),
	('edc26418-28e1-4fce-88ab-322b7eaebeed', '81032477-004a-42b4-bba4-e19eece536a1', '725db07d-eb81-4854-99df-b93aaea5a1a1', NULL, NULL, NULL, NULL, 'Strict', 'matched', '2025-12-13 11:35:30.094615+00'),
	('31d23a88-34f8-4b74-92e1-e6f22c6eec11', '2b666b38-2040-42c3-bc9c-ea1daca864f6', '3fbeab85-24f7-4a26-8ca7-e02a92518ddc', NULL, NULL, NULL, NULL, 'Strict', 'cancelled', '2025-12-13 12:58:50.80322+00'),
	('3cc2a508-5b3f-4f38-a448-6062623310ef', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', '80a44aa5-a6e0-404f-865a-c2ffec3b94f1', NULL, NULL, NULL, NULL, 'Strict', 'cancelled', '2025-12-13 12:58:50.345708+00'),
	('37812cc8-715d-428b-9bf5-961eebd1e2d2', '2b666b38-2040-42c3-bc9c-ea1daca864f6', '5bc08896-4f02-42ef-a3f0-64840bf561d2', NULL, NULL, NULL, NULL, 'Strict', 'matched', '2025-12-13 13:00:20.682393+00'),
	('aceeb382-c216-4477-a911-353aecaf3ae9', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', 'd1a1921a-c3ba-484a-8018-93aac68d17b6', NULL, NULL, NULL, NULL, 'Strict', 'matched', '2025-12-13 13:00:26.193533+00'),
	('6cf83254-49e9-4e6a-8e32-4bcf8ddf6d2a', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', '5581d54c-6c1a-4cd7-9e9d-1c66defa37cb', NULL, NULL, NULL, NULL, 'Strict', 'cancelled', '2025-12-13 13:00:45.742311+00'),
	('49c8d86c-6c19-4517-a1e3-53606e1a407f', '2b666b38-2040-42c3-bc9c-ea1daca864f6', '345e0990-5003-4d47-9b27-7ef9a7829eff', NULL, NULL, NULL, NULL, 'Strict', 'matched', '2025-12-13 13:01:08.827648+00'),
	('1ccf18dc-71b1-45f3-9cd1-45c745fe3c69', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', '8c813d96-9667-4496-8034-4d994761011c', NULL, NULL, NULL, NULL, 'Strict', 'matched', '2025-12-13 13:01:10.620916+00'),
	('8f9d5d41-0730-47f3-9869-6a8d9a15faa9', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', '73503355-ca5e-4180-ae9e-464f1528e2a1', NULL, NULL, NULL, NULL, 'Strict', 'matched', '2025-12-13 13:01:36.367534+00'),
	('d9125303-98ac-412e-be6d-3d2c0945a669', '2b666b38-2040-42c3-bc9c-ea1daca864f6', 'b852e635-628f-4fbf-97d9-e773d1c18dcc', NULL, NULL, NULL, NULL, 'Strict', 'matched', '2025-12-13 13:01:37.548979+00'),
	('5a27bb75-b6b5-469d-884d-624fa4a86e4e', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', '07eb8de8-f3c4-4fde-86a5-53b87d7c3e43', NULL, NULL, NULL, NULL, 'Strict', 'cancelled', '2025-12-13 05:39:11.822189+00'),
	('12822d80-5cc9-4326-8557-a8d753aa7676', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', '3c5659f1-2c45-4766-a5f8-58e7e819ee75', NULL, NULL, NULL, NULL, 'Strict', 'matched', '2025-12-13 05:41:42.082744+00'),
	('254bce83-ed91-4fb6-bc5d-7c26313a45a0', '2b666b38-2040-42c3-bc9c-ea1daca864f6', 'd3c4d41a-851c-4d09-b0cf-4b08486c8611', NULL, NULL, NULL, NULL, 'Strict', 'matched', '2025-12-13 05:42:58.567276+00');


--
-- Data for Name: match_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."match_sessions" ("id", "profile_a_id", "profile_b_id", "request_a_id", "request_b_id", "trip_card_a_id", "trip_card_b_id", "match_score", "conversation_id", "status", "created_at") VALUES
	('64fdad0a-fda3-4a1a-adb3-567605f7d4e6', '2b666b38-2040-42c3-bc9c-ea1daca864f6', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', '254bce83-ed91-4fb6-bc5d-7c26313a45a0', '12822d80-5cc9-4326-8557-a8d753aa7676', 'd3c4d41a-851c-4d09-b0cf-4b08486c8611', '3c5659f1-2c45-4766-a5f8-58e7e819ee75', NULL, '693840c0cb7fbfc7a432bcb3', 'pending', '2025-12-13 05:42:58.567276+00'),
	('5085aecd-4dcd-4aea-806e-12c594e7bc18', '81032477-004a-42b4-bba4-e19eece536a1', 'a98dc093-b9d5-40e8-a2fd-ce4cb352c488', '317f1381-b9db-45df-8507-533670e415fa', '88859bd3-9149-458d-a79d-16abd3cc564a', 'f8d0fe3d-536e-459c-93c6-b46cf15cf864', 'dbef00a8-e0c9-4786-99d2-037202fccac5', NULL, '693d4f52cb7fbfc7a45e087a', 'pending', '2025-12-13 11:34:40.941591+00'),
	('6077a641-38a9-44dc-8274-424e92418a68', '81032477-004a-42b4-bba4-e19eece536a1', 'a98dc093-b9d5-40e8-a2fd-ce4cb352c488', 'edc26418-28e1-4fce-88ab-322b7eaebeed', 'cdb839fd-1f71-4285-af40-89de5261c80b', '725db07d-eb81-4854-99df-b93aaea5a1a1', '59a06002-0deb-45ba-a128-1028302056f1', NULL, '693d4f52cb7fbfc7a45e087a', 'pending', '2025-12-13 11:35:30.094615+00'),
	('1b9cffe8-19fc-44b2-b097-049b30133eb2', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', '2b666b38-2040-42c3-bc9c-ea1daca864f6', 'aceeb382-c216-4477-a911-353aecaf3ae9', '37812cc8-715d-428b-9bf5-961eebd1e2d2', 'd1a1921a-c3ba-484a-8018-93aac68d17b6', '5bc08896-4f02-42ef-a3f0-64840bf561d2', NULL, NULL, 'pending', '2025-12-13 13:00:26.193533+00'),
	('89761c47-1c70-48ee-8853-039983111eb5', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', '2b666b38-2040-42c3-bc9c-ea1daca864f6', '1ccf18dc-71b1-45f3-9cd1-45c745fe3c69', '49c8d86c-6c19-4517-a1e3-53606e1a407f', '8c813d96-9667-4496-8034-4d994761011c', '345e0990-5003-4d47-9b27-7ef9a7829eff', NULL, '693840c0cb7fbfc7a432bcb3', 'pending', '2025-12-13 13:01:10.620916+00'),
	('3b18c598-ab81-488c-8b55-dbfce3051bb8', '2b666b38-2040-42c3-bc9c-ea1daca864f6', '361c0bc7-03af-4829-8c1b-6faa2ef0b678', 'd9125303-98ac-412e-be6d-3d2c0945a669', '8f9d5d41-0730-47f3-9869-6a8d9a15faa9', 'b852e635-628f-4fbf-97d9-e773d1c18dcc', '73503355-ca5e-4180-ae9e-464f1528e2a1', NULL, '693840c0cb7fbfc7a432bcb3', 'pending', '2025-12-13 13:01:37.548979+00');


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."orders" ("id", "order_no", "traveler_id", "host_id", "experience_id", "start_time", "end_time", "people_count", "status", "payment_status", "total_amount", "currency", "platform_fee", "host_earnings", "traveler_note", "created_at", "paid_at", "confirmed_at", "started_at", "completed_at", "cancelled_at", "cancelled_reason", "cancelled_by") VALUES
	(1, 'ORD1765208092109398849', 'a5f666fd-6957-4dfd-92c8-bd59b49bfbfc', '53b43071-f448-40bf-89ea-38bdd90b5a5c', '6932dd05f05e621fb1835532', '2025-12-13 01:00:00+00', '2025-12-13 03:00:00+00', 2, 'PENDING_HOST_CONFIRM', 'PAID', 396.00, 'CNY', 0.00, 0.00, NULL, '2025-12-08 15:34:52.294103+00', '2025-12-08 15:34:52.109+00', NULL, NULL, NULL, NULL, NULL, NULL),
	(2, 'ORD1765208102153671045', 'a5f666fd-6957-4dfd-92c8-bd59b49bfbfc', '53b43071-f448-40bf-89ea-38bdd90b5a5c', '6932dd05f05e621fb1835532', '2025-12-13 01:00:00+00', '2025-12-13 03:00:00+00', 2, 'PENDING_HOST_CONFIRM', 'PAID', 396.00, 'CNY', 0.00, 0.00, NULL, '2025-12-08 15:35:02.487184+00', '2025-12-08 15:35:02.153+00', NULL, NULL, NULL, NULL, NULL, NULL),
	(3, 'ORD1765208378415961767', 'a5f666fd-6957-4dfd-92c8-bd59b49bfbfc', '53b43071-f448-40bf-89ea-38bdd90b5a5c', '6932dd05f05e621fb1835532', '2025-12-13 01:00:00+00', '2025-12-13 03:00:00+00', 2, 'PENDING_HOST_CONFIRM', 'PAID', 396.00, 'CNY', 0.00, 0.00, NULL, '2025-12-08 15:39:38.498597+00', '2025-12-08 15:39:38.415+00', NULL, NULL, NULL, NULL, NULL, NULL);


--
-- Data for Name: order_status_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."order_status_logs" ("id", "order_id", "from_status", "to_status", "actor_id", "actor_role", "reason", "created_at") VALUES
	(1, 1, NULL, 'PENDING_HOST_CONFIRM', 'a5f666fd-6957-4dfd-92c8-bd59b49bfbfc', 'TRAVELER', NULL, '2025-12-08 15:34:52.678169+00'),
	(2, 2, NULL, 'PENDING_HOST_CONFIRM', 'a5f666fd-6957-4dfd-92c8-bd59b49bfbfc', 'TRAVELER', NULL, '2025-12-08 15:35:02.785221+00'),
	(3, 3, NULL, 'PENDING_HOST_CONFIRM', 'a5f666fd-6957-4dfd-92c8-bd59b49bfbfc', 'TRAVELER', NULL, '2025-12-08 15:39:38.678759+00');


--
-- Data for Name: reviews; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: service_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: settlements; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: buckets_vectors; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: objects; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: prefixes; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: vector_indexes; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: supabase_auth_admin
--

SELECT pg_catalog.setval('"auth"."refresh_tokens_id_seq"', 38, true);


--
-- Name: order_status_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."order_status_logs_id_seq"', 3, true);


--
-- Name: orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."orders_id_seq"', 3, true);


--
-- Name: reviews_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."reviews_id_seq"', 1, false);


--
-- Name: service_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."service_logs_id_seq"', 1, false);


--
-- Name: settlements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."settlements_id_seq"', 1, false);


--
-- PostgreSQL database dump complete
--

-- \unrestrict R777KTjARTeKS0qcBzGi4dfj8eAwIVb8sxrERznwOQnQwODPTckMdSX86uLQ7g0

RESET ALL;
