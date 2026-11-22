-- A teacher's classes by teacher (the primary key leads with class_id), so the console's class list is a SEARCH, not a scan of classes.
CREATE INDEX class_teachers_teacher ON class_teachers(teacher_id, class_id);
