-- Task Priority Type
CREATE TYPE public.task_priority AS ENUM (
    'Low',
    'Medium',
    'High'
);

-- Task Status Type
CREATE TYPE public.task_status AS ENUM (
    'To Do',
    'In Progress',
    'Review',
    'Done'
);

-- Source Type
CREATE TYPE public.source AS ENUM (
    'engage',
    'task_master'
);

-- Task Session Types
CREATE TYPE public.task_session_types AS ENUM (
    'MANUAL',
    'TRACKED'
);