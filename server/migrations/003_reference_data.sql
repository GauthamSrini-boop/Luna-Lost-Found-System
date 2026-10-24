-- Reference data only (selectable lists). No users, reports or statistics are created here.
-- Administrators can add, rename or deactivate these from the admin pages.
INSERT INTO categories (name) VALUES
  ('Electronics'), ('Wallets & Cards'), ('Keys'), ('Bags & Backpacks'), ('Clothing'),
  ('Books & Stationery'), ('Jewellery & Accessories'), ('Water Bottles'), ('ID Cards'),
  ('Sports Equipment'), ('Other');
INSERT INTO campus_locations (name, zone) VALUES
  ('Main Library', 'academic-core'), ('Student Union', 'central'), ('Cafeteria', 'central'),
  ('Auditorium', 'central'), ('Engineering Block', 'academic-north'), ('Science Block', 'academic-north'),
  ('Sports Complex', 'sports'), ('Hostel A', 'residential'), ('Hostel B', 'residential'),
  ('Main Gate', 'entrance'), ('Parking Lot', 'entrance'), ('Other / Unknown', 'general');
