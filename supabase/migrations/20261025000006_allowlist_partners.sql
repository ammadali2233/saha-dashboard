-- Sign-in allowlist for the four partners, linked to their capital records.

insert into public.app_users (email, display_name, role) values
  ('ammadali33@gmail.com', 'Ammad Ali', 'owner'),
  ('hamzadar.hd@gmail.com', 'Hamza Mahad Dar', 'partner'),
  ('azm2006@gmail.com', 'Mohammed Azeem', 'partner'),
  ('saadraza322@gmail.com', 'Saad Raza', 'partner');

update public.partners p
set email = u.email, app_user_id = u.id
from public.app_users u
where u.display_name = p.name;
