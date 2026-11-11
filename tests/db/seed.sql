insert into auth.users (id, email, email_confirmed_at) values
 ('11111111-1111-1111-1111-111111111111','suba@test.local',now()),
 ('22222222-2222-2222-2222-222222222222','subb@test.local',now()),
 ('33333333-3333-3333-3333-333333333333','tourism@test.local',now()),
 ('44444444-4444-4444-4444-444444444444','admin@test.local',now()),
 ('55555555-5555-5555-5555-555555555555','mto@test.local',now()),
 ('66666666-6666-6666-6666-666666666666','sb@test.local',now()),
 ('77777777-7777-7777-7777-777777777777','mayor@test.local',now()) on conflict do nothing;
insert into public.profiles (id, email, full_name, role) values
 ('11111111-1111-1111-1111-111111111111','suba@test.local','Submitter A','submitter'),
 ('22222222-2222-2222-2222-222222222222','subb@test.local','Submitter B','submitter'),
 ('33333333-3333-3333-3333-333333333333','tourism@test.local','Tourism Officer','tourism_officer'),
 ('44444444-4444-4444-4444-444444444444','admin@test.local','System Admin','system_admin'),
 ('55555555-5555-5555-5555-555555555555','mto@test.local','MTO Officer','municipal_treasurer'),
 ('66666666-6666-6666-6666-666666666666','sb@test.local','SB Officer','sangguniang_bayan'),
 ('77777777-7777-7777-7777-777777777777','mayor@test.local','Mayor Officer','mayor_office') on conflict do nothing;
