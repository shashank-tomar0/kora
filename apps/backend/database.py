import sqlite3
import os
import uuid
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kora.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON;")
    
    # Create Users Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        phone_number TEXT UNIQUE,
        name TEXT NOT NULL,
        college TEXT,
        branch TEXT,
        year INTEGER CHECK (year BETWEEN 1 AND 6),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    # Migrations for Google Sign-in fields
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN email TEXT;")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT;")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0;")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 1;")
    except sqlite3.OperationalError:
        pass
    
    # Create Schedule Events Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS schedule_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        title TEXT NOT NULL,
        day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Monday, 6=Sunday
        time_start TEXT NOT NULL, -- "HH:MM"
        time_end TEXT NOT NULL, -- "HH:MM"
        room TEXT,
        professor TEXT,
        source TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    
    # Create Deadlines Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS deadlines (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        due_at TEXT NOT NULL, -- ISO-8601 string
        subject TEXT,
        type TEXT CHECK(type IN ('ASSIGNMENT', 'EXAM', 'PROJECT', 'QUIZ', 'OTHER')),
        status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'DONE', 'SNOOZED', 'OVERDUE')),
        source_raw TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    
    # Create Expenses Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount REAL NOT NULL CHECK(amount > 0),
        merchant TEXT NOT NULL,
        category TEXT CHECK(category IN ('MESS', 'CANTEEN', 'TRANSPORT', 'BOOKS', 'ENTERTAINMENT', 'STATIONARY', 'OTHER')),
        transacted_at TEXT NOT NULL, -- ISO-8601 string
        source TEXT CHECK(source IN ('RECEIPT_OCR', 'UPI_SMS', 'MANUAL')),
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    
    # Create Flashcards Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS flashcards (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        front TEXT NOT NULL,
        back TEXT NOT NULL,
        difficulty INTEGER DEFAULT 3,
        next_review_at TEXT NOT NULL, -- ISO-8601 string
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    
    # Create Study Roadmaps Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS study_roadmaps (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        steps_json TEXT NOT NULL, -- JSON list of steps: [{"id": 1, "title": "...", "checked": false}]
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    
    # Create Study History Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS study_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        reviewed_at TEXT NOT NULL, -- ISO-8601 string
        rating INTEGER NOT NULL, -- 1=Hard, 2=Medium, 3=Easy
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (card_id) REFERENCES flashcards(id) ON DELETE CASCADE
    );
    """)
    
    # Create Chat Messages Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        sender TEXT CHECK(sender IN ('kora', 'user')) NOT NULL,
        text TEXT NOT NULL,
        time TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    
    # Create User Settings Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        secretary_mode INTEGER DEFAULT 0, -- 0=OFF, 1=ON
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    
    # Create User Balances Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_balances (
        id TEXT PRIMARY KEY,
        lender_id TEXT NOT NULL,
        borrower_id TEXT NOT NULL,
        amount REAL NOT NULL CHECK(amount > 0),
        description TEXT,
        status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'SETTLED')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (lender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (borrower_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    
    # Create Subject Attendance Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS subject_attendance (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        present INTEGER DEFAULT 0,
        absent INTEGER DEFAULT 0,
        UNIQUE(user_id, subject),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # Create Lecture Notes Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS lecture_notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # Create Mess Menus Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS mess_menus (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        day_of_week INTEGER NOT NULL,
        meal_type TEXT NOT NULL, -- 'BREAKFAST', 'LUNCH', 'DINNER'
        items TEXT NOT NULL,
        price REAL DEFAULT 0.0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # Create Quiz Duels Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS quiz_duels (
        id TEXT PRIMARY KEY,
        creator_id TEXT NOT NULL,
        joiner_id TEXT,
        subject TEXT NOT NULL,
        status TEXT DEFAULT 'LOBBY', -- 'LOBBY', 'ACTIVE', 'COMPLETED'
        questions_json TEXT NOT NULL,
        creator_score INTEGER DEFAULT 0,
        joiner_score INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    # Create Memory Nodes Table (Second Brain / OpenHuman concept)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS memory_nodes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT CHECK(type IN ('source_tree', 'topic_tree', 'global_tree')) NOT NULL,
        title TEXT NOT NULL,
        source TEXT,
        file_path TEXT NOT NULL,
        summary TEXT,
        last_updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    
    # Create Course Materials Table (RAG tutor)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS course_materials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    
    conn.commit()
    conn.close()

    # Initialize Memory Vault Directories
    vault_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "memory_vault")
    os.makedirs(os.path.join(vault_dir, "source_trees"), exist_ok=True)
    os.makedirs(os.path.join(vault_dir, "topic_trees"), exist_ok=True)
    os.makedirs(os.path.join(vault_dir, "global_trees"), exist_ok=True)

# Seed default user if not exists
def seed_default_user():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users LIMIT 1")
    user = cursor.fetchone()
    if not user:
        user_id = str(uuid.uuid4())
        cursor.execute("""
        INSERT INTO users (id, phone_number, name, college, branch, year)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (user_id, "+919999999999", "Arjun", "Indian Institute of Technology", "Computer Science", 3))
        conn.commit()
        print(f"Seeded default user: {user_id}")
    else:
        user_id = user[0]
        print(f"Default user already exists: {user_id}")
    conn.close()
    return user_id

init_db()
seed_default_user()

def proactive_allocate_logic(uid):
    import datetime as dt
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Fetch pending deadlines
    cursor.execute("SELECT id, title, subject, due_at FROM deadlines WHERE user_id = ? AND status = 'PENDING'", (uid,))
    deadlines = [dict(r) for r in cursor.fetchall()]
    
    # Fetch existing schedule events
    cursor.execute("SELECT day_of_week, time_start, time_end FROM schedule_events WHERE user_id = ?", (uid,))
    schedule = [dict(r) for r in cursor.fetchall()]
    
    # Fetch existing STUDY_ALLOCATOR schedules to avoid duplicates
    cursor.execute("SELECT title FROM schedule_events WHERE user_id = ? AND source = 'STUDY_ALLOCATOR'", (uid,))
    existing_allocs = [r["title"] for r in cursor.fetchall()]
    
    allocated_count = 0
    
    for dl in deadlines:
        title = f"Prep: {dl['title']}"
        if title in existing_allocs:
            continue
            
        try:
            # Parse due_at (support both ISO datetime and simple date format)
            if 'T' in dl["due_at"]:
                due_dt = dt.datetime.fromisoformat(dl["due_at"])
            else:
                due_dt = dt.datetime.strptime(dl["due_at"], "%Y-%m-%d")
            # Strip timezone info to prevent offset-naive vs offset-aware comparison crashes
            if due_dt.tzinfo is not None:
                due_dt = due_dt.replace(tzinfo=None)
        except Exception:
            due_dt = dt.datetime.now() + dt.timedelta(days=2)
            
        study_dt = due_dt - dt.timedelta(days=1)
        if study_dt < dt.datetime.now():
            study_dt = dt.datetime.now()
            
        day_of_week = study_dt.weekday() # 0 = Monday, 6 = Sunday
        
        possible_slots = ["14:00", "15:00", "16:00", "17:00", "18:00", "19:00"]
        chosen_slot = None
        
        for slot in possible_slots:
            slot_start = slot
            slot_end = f"{int(slot.split(':')[0]) + 1}:00"
            
            overlap = False
            for class_event in schedule:
                if class_event["day_of_week"] == day_of_week:
                    c_start = class_event["time_start"]
                    c_end = class_event["time_end"]
                    if not (slot_end <= c_start or slot_start >= c_end):
                        overlap = True
                        break
            if not overlap:
                chosen_slot = slot
                break
                
        if not chosen_slot:
            chosen_slot = "17:00"
            
        slot_start = chosen_slot
        slot_end = f"{int(chosen_slot.split(':')[0]) + 1}:00"
        
        event_id = str(uuid.uuid4())
        cursor.execute("""
        INSERT INTO schedule_events (id, user_id, subject, title, day_of_week, time_start, time_end, room, professor, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Library', 'Self Study', 'STUDY_ALLOCATOR')
        """, (
            event_id,
            uid,
            dl.get("subject") or "General",
            title,
            day_of_week,
            slot_start,
            slot_end
        ))
        allocated_count += 1
        
    conn.commit()
    conn.close()
    return allocated_count

