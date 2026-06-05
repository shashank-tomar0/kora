from dotenv import load_dotenv
load_dotenv(override=True)

import os
import re
import json
import uuid
import google.generativeai as genai
from datetime import datetime
import sqlite3
from database import get_db_connection, proactive_allocate_logic

# Configure Gemini
api_key = os.environ.get("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)
else:
    print("WARNING: GEMINI_API_KEY environment variable is not set!")

def get_gemini_model():
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not configured in the environment.")
    return genai.GenerativeModel("gemini-2.5-flash")

# Helper to fetch student context
def get_student_context(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()
    if not user:
        conn.close()
        return "User not found"
        
    user_dict = dict(user)
    
    # Fetch schedules
    cursor.execute("SELECT subject, title, day_of_week, time_start, time_end, room, professor FROM schedule_events WHERE user_id = ?", (user_id,))
    schedules = [dict(r) for r in cursor.fetchall()]
    
    # Fetch deadlines
    cursor.execute("SELECT title, due_at, subject, type, status FROM deadlines WHERE user_id = ?", (user_id,))
    deadlines = [dict(r) for r in cursor.fetchall()]
    
    # Fetch expenses
    cursor.execute("SELECT amount, merchant, category, transacted_at, source, notes FROM expenses WHERE user_id = ?", (user_id,))
    expenses = [dict(r) for r in cursor.fetchall()]
    
    # Fetch recent chat history context
    chat_history = []
    try:
        cursor.execute("""
        SELECT sender, text, time 
        FROM chat_messages 
        WHERE user_id = ? 
        ORDER BY created_at DESC 
        LIMIT 20
        """, (user_id,))
        chat_history = [dict(r) for r in cursor.fetchall()]
        chat_history.reverse()
    except sqlite3.OperationalError:
        pass
        
    # Fetch attendance
    attendance = []
    try:
        cursor.execute("SELECT subject, present, absent FROM subject_attendance WHERE user_id = ?", (user_id,))
        attendance = [dict(r) for r in cursor.fetchall()]
    except Exception:
        pass
        
    conn.close()
    
    return {
        "user_profile": user_dict,
        "schedules": schedules,
        "deadlines": deadlines,
        "expenses": expenses,
        "chat_history": chat_history,
        "attendance": attendance,
        "current_time": datetime.now().isoformat()
    }

# Agent 1: Timetable/Schedule Parser (OCR + Vision)
def parse_timetable_image(image_bytes, mime_type="image/jpeg"):
    try:
        model = get_gemini_model()
        prompt = """
        Analyze this college timetable image. Extract all classes and classes schedules.
        Return ONLY a valid JSON list of objects representing the schedule blocks.
        Do not add markdown formatting outside of a ```json ``` block.
        
        Each block in the list must have the following keys:
        - subject: Name of the course/subject (e.g. "Data Structures", "ML", "Mathematics")
        - title: "Lecture", "Lab", or "Tutorial"
        - day_of_week: Integer from 0 (Monday) to 6 (Sunday)
        - time_start: Start time in 24-hour format "HH:MM" (e.g. "09:00")
        - time_end: End time in 24-hour format "HH:MM" (e.g. "10:30")
        - room: Classroom number or lab name (e.g. "LH-101", "Lab 3") (optional, use null if not found)
        - professor: Name of the teacher/professor (optional, use null if not found)
        
        Ensure the JSON is strictly valid.
        """
        
        contents = [
            {
                'mime_type': mime_type,
                'data': image_bytes
            },
            prompt
        ]
        
        response = model.generate_content(contents)
        text = response.text.strip()
        
        # Clean code block symbols if present
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
            
        return json.loads(text)
    except Exception as e:
        print(f"Gemini API error in parse_timetable_image: {e}. Running local fallback...")
        return [
            {"subject": "DBMS Lecture (Local)", "title": "Lecture", "day_of_week": 0, "time_start": "09:00", "time_end": "10:15", "room": "LH-101", "professor": "Dr. Sharma"},
            {"subject": "DSA Lab (Local)", "title": "Lab", "day_of_week": 1, "time_start": "14:00", "time_end": "16:00", "room": "Lab 2", "professor": "Prof. Verma"}
        ]

# Agent 2: Receipt/Expense Parser (OCR + Vision)
def parse_receipt_image(image_bytes, mime_type="image/jpeg"):
    try:
        model = get_gemini_model()
        prompt = """
        Analyze this receipt or payment screenshot image.
        Extract the total transaction amount, merchant name, category, and transactional details.
        Return ONLY a valid JSON object representing the transaction.
        Do not add markdown formatting outside of a ```json ``` block.
        
        The JSON object must have:
        - amount: Numeric value (e.g. 340.50) (must be a float/integer, no currency symbols)
        - merchant: Name of the shop, canteen, or payee (e.g. "Canteen", "Tap Tap Tea", "Hostel Mess")
        - category: Must be one of: "MESS", "CANTEEN", "TRANSPORT", "BOOKS", "ENTERTAINMENT", "STATIONARY", "OTHER"
        - notes: Short summary of items bought or context (e.g. "Notebook, 2 pens", "Maggie and Cold Coffee")
        
        If it is a UPI payment success screenshot, read the payee and amount.
        Ensure the JSON is strictly valid.
        """
        
        contents = [
            {
                'mime_type': mime_type,
                'data': image_bytes
            },
            prompt
        ]
        
        response = model.generate_content(contents)
        text = response.text.strip()
        
        # Clean code block symbols if present
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
            
        return json.loads(text)
    except Exception as e:
        print(f"Gemini API error in parse_receipt_image: {e}. Running local fallback...")
        return {
            "amount": 150.0,
            "merchant": "Canteen (Local)",
            "category": "CANTEEN",
            "notes": "Simulated raw receipt amount parsed locally"
        }

# Agent 3: Chat Assistant & Orchestrator
def handle_chat_query_fallback(user_id, query_text):
    query_lower = query_text.lower().strip()
    
    # 1. EXPENSE LOGGING FALLBACK
    expense_match = re.search(r'(?:log|spent|spent\s+of|cost\s+of)\s*(?:₹|rs\.?|rupees)?\s*(\d+(?:\.\d+)?)\s*(?:rupees|rs)?\s*(?:at|from|for|on)?\s*([a-zA-Z0-9\s]+)', query_lower)
    if not expense_match:
        expense_match = re.search(r'log\s+([a-zA-Z0-9\s]+)\s+expense\s+of\s*(?:₹|rs\.?|rupees)?\s*(\d+(?:\.\d+)?)', query_lower)
        if expense_match:
            merchant = expense_match.group(1).strip()
            amount = float(expense_match.group(2))
        else:
            merchant = None
    else:
        amount = float(expense_match.group(1))
        merchant = expense_match.group(2).strip()
        merchant = re.sub(r'\s*(?:rupees|rs|under|category).*', '', merchant).strip()

    if expense_match and amount > 0:
        merchant_name = merchant or "canteen"
        category = "CANTEEN"
        if "mess" in query_lower:
            category = "MESS"
        elif "transport" in query_lower or "cab" in query_lower or "auto" in query_lower or "metro" in query_lower:
            category = "TRANSPORT"
        elif "book" in query_lower or "stationery" in query_lower or "stationary" in query_lower or "xerox" in query_lower:
            category = "BOOKS"
        elif "movie" in query_lower or "game" in query_lower or "party" in query_lower or "entertainment" in query_lower:
            category = "ENTERTAINMENT"
            
        reply = f"Got it. I've logged an expense of ₹{amount:.0f} at {merchant_name} under {category}. (Local Fallback)"
        action_block = f"""
@ACTION
{{
    "action": "CREATE_EXPENSE",
    "data": {{
        "amount": {amount},
        "merchant": "{merchant_name}",
        "category": "{category}",
        "notes": "{query_text}"
    }}
}}"""
        return reply + action_block

    # 2. SCHEDULE FALLBACK
    if "class" in query_lower or "schedule" in query_lower or "timetable" in query_lower or "lecture" in query_lower:
        import datetime as dt
        now = dt.datetime.now()
        target_day = now.weekday()
        day_label = "today"
        
        if "tomorrow" in query_lower:
            target_day = (now.weekday() + 1) % 7
            day_label = "tomorrow"
        elif "monday" in query_lower:
            target_day = 0
            day_label = "Monday"
        elif "tuesday" in query_lower:
            target_day = 1
            day_label = "Tuesday"
        elif "wednesday" in query_lower:
            target_day = 2
            day_label = "Wednesday"
        elif "thursday" in query_lower:
            target_day = 3
            day_label = "Thursday"
        elif "friday" in query_lower:
            target_day = 4
            day_label = "Friday"
        elif "saturday" in query_lower:
            target_day = 5
            day_label = "Saturday"
        elif "sunday" in query_lower:
            target_day = 6
            day_label = "Sunday"
            
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("""
            SELECT subject, title, time_start, time_end, room 
            FROM schedule_events 
            WHERE user_id = ? AND day_of_week = ?
            ORDER BY time_start ASC
            """, (user_id, target_day))
            classes = cursor.fetchall()
            conn.close()
        except Exception:
            classes = []
            
        if classes:
            class_lines = []
            for c in classes:
                class_lines.append(f"- {c['subject']} {c['title']} at {c['time_start']}-{c['time_end']} in room {c['room']}")
            reply = f"Here is your class schedule for {day_label}: \n" + "\n".join(class_lines) + "\n(Local Fallback)"
        else:
            reply = f"You have no classes scheduled for {day_label}. Your schedule is clear! (Local Fallback)"
            
        action_block = "\n@ACTION\n{\n    \"action\": \"NONE\",\n    \"data\": {}\n}"
        return reply + action_block

    # 3. FLASHCARDS FALLBACK
    if "flashcard" in query_lower or "syllabus" in query_lower or "study" in query_lower:
        reply = "Sure! I've loaded your study flashcards for your syllabus. You can review them in the Study tab! (Local Fallback)"
        action_block = "\n@ACTION\n{\n    \"action\": \"NONE\",\n    \"data\": {}\n}"
        return reply + action_block

    # 4. DEFAULT CHATTY FALLBACK
    reply = "Hi! I am Kora, your student life OS. (Note: Running in local offline mode due to API quota limits). How can I help you manage your schedule, deadlines, or expenses today?"
    action_block = "\n@ACTION\n{\n    \"action\": \"NONE\",\n    \"data\": {}\n}"
    return reply + action_block

# Agent 3: Chat Assistant & Orchestrator
def handle_chat_query(user_id, query_text):
    try:
        model = get_gemini_model()
        context = get_student_context(user_id)
        
        # Query memory vault for long-term context
        memory_context = ""
        try:
            memory_context = query_memory_vault(user_id, query_text)
        except Exception as me:
            print("Error querying memory vault:", me)
        
        prompt = f"""
        You are Kora, the advanced personal AI agent built to manage an Indian student's life.
        The phone is the user's interface, and the laptop/server is the muscle.
        
        Here is the student's current database context (schedules, deadlines, expenses, profile):
        {json.dumps(context, indent=2)}
        {memory_context}
        
        Current local timestamp is: {datetime.now().strftime("%A, %Y-%m-%d %H:%M:%S")}
        
        INSTRUCTIONS:
        - Respond directly, concisely, and with a premium, helpful, non-robotic tone.
        - Review the `chat_history` context to remember previous user requests, WhatsApp updates, or conversations. If the user asks about something they previously messaged you on WhatsApp or in the app, look it up in the `chat_history` and answer accurately.
        - If the query text is a forwarded WhatsApp message containing a deadline, assignment, exam, quiz, class, extra lecture, or expense, you MUST proactively parse and schedule it immediately by outputting the correct CREATE_DEADLINE or CREATE_SCHEDULE action! Do not wait for the user to ask you to add it; if the text says it is scheduled, due, or incurred, log it now.
        - Calculate relative days (like "tomorrow", "next Friday", "Wednesday") based on the current local timestamp day of the week.
        - Respond intelligently to attendance and bunking queries. If the student asks about bunking a class or their attendance statistics, check the `attendance` records (where each subject has `present` and `absent` counts), compute their current percentage (Present / (Present + Absent) * 100), compare it to the strict 75% threshold, and advise them on how many classes they can bunk safely or how many they need to attend. Keep the tone witty and encouraging!
        - To perform actions on the database, you must include a JSON block in your response starting with `@ACTION` on a new line, containing the action structure.
        
        The @ACTION schema is:
        @ACTION
        {{
            "action": "CREATE_DEADLINE" | "CREATE_EXPENSE" | "CREATE_SCHEDULE" | "COMPLETE_DEADLINE" | "NONE",
            "data": {{ ... }}
        }}
        
        Data schemas for CREATE actions:
        - CREATE_DEADLINE: {{"title": "...", "due_at": "YYYY-MM-DDTHH:MM:SS", "subject": "...", "type": "ASSIGNMENT"|"EXAM"|"PROJECT"|"QUIZ"|"OTHER"}}
        - CREATE_EXPENSE: {{"amount": 120.0, "merchant": "...", "category": "MESS"|"CANTEEN"|..., "notes": "..."}}
        - CREATE_SCHEDULE: {{"subject": "...", "title": "Lecture"|"Lab", "day_of_week": 0..6, "time_start": "HH:MM", "time_end": "HH:MM", "room": "...", "professor": "..."}}
        - COMPLETE_DEADLINE: {{"title": "Exact title match of deadline to complete"}}
        
        If no database action is needed, use action "NONE". Only include ONE action per response.
        
        Example response when user says: "Log tea cost of 15 rupees from tapri"
        "Got it. I've logged an expense of ₹15 at tapri under CANTEEN."
        @ACTION
        {{
            "action": "CREATE_EXPENSE",
            "data": {{
                "amount": 15.0,
                "merchant": "tapri",
                "category": "CANTEEN",
                "notes": "Tea"
            }}
        }}
        
        Reply to the student now:
        "{query_text}"
        """
        
        response = model.generate_content(prompt)
        response_text = response.text.strip()
    except Exception as e:
        print(f"Gemini API error in handle_chat_query: {e}. Running local rule-based fallback...")
        response_text = handle_chat_query_fallback(user_id, query_text)
    
    # Parse action block if exists
    action_data = None
    cleaned_reply = response_text
    
    if "@ACTION" in response_text:
        parts = response_text.split("@ACTION")
        cleaned_reply = parts[0].strip()
        action_json_str = parts[1].strip()
        try:
            # Strip potential ```json markers
            if "```json" in action_json_str:
                action_json_str = action_json_str.split("```json")[1].split("```")[0].strip()
            elif "```" in action_json_str:
                action_json_str = action_json_str.split("```")[1].split("```")[0].strip()
            action_data = json.loads(action_json_str)
        except Exception as e:
            print("Failed to parse agent action JSON:", e, "Raw string was:", action_json_str)
            
    # Apply actions to database if parsed successfully
    if action_data and action_data.get("action") != "NONE":
        execute_agent_action(user_id, action_data)
        
    return cleaned_reply

def execute_agent_action(user_id, action_data):
    conn = get_db_connection()
    cursor = conn.cursor()
    action_type = action_data.get("action")
    data = action_data.get("data", {})
    
    try:
        if action_type == "CREATE_DEADLINE":
            cursor.execute("""
            INSERT INTO deadlines (id, user_id, title, due_at, subject, type, status)
            VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
            """, (
                str(uuid.uuid4()),
                user_id,
                data.get("title"),
                data.get("due_at", datetime.now().isoformat()),
                data.get("subject"),
                data.get("type", "OTHER")
            ))
            conn.commit()
            print(f"Agent logged deadline: {data.get('title')}")
            try:
                allocs = proactive_allocate_logic(user_id)
                print(f"Proactive study allocator scheduled {allocs} blocks.")
            except Exception as pe:
                print(f"Proactive allocator error: {pe}")
            
        elif action_type == "CREATE_EXPENSE":
            category_upper = (data.get("category") or "OTHER").upper()
            valid_categories = {'MESS', 'CANTEEN', 'TRANSPORT', 'BOOKS', 'ENTERTAINMENT', 'STATIONARY', 'OTHER'}
            if category_upper == "STATIONERY":
                category_upper = "STATIONARY"
            elif category_upper not in valid_categories:
                category_upper = "OTHER"
                
            cursor.execute("""
            INSERT INTO expenses (id, user_id, amount, merchant, category, transacted_at, source, notes)
            VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', ?)
            """, (
                str(uuid.uuid4()),
                user_id,
                float(data.get("amount", 0)),
                data.get("merchant", "Unknown"),
                category_upper,
                datetime.now().isoformat(),
                data.get("notes")
            ))
            conn.commit()
            print(f"Agent logged expense: Rs. {data.get('amount')} at {data.get('merchant')}")
            
        elif action_type == "CREATE_SCHEDULE":
            cursor.execute("""
            INSERT INTO schedule_events (id, user_id, subject, title, day_of_week, time_start, time_end, room, professor, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL')
            """, (
                str(uuid.uuid4()),
                user_id,
                data.get("subject"),
                data.get("title", "Lecture"),
                int(data.get("day_of_week", 0)),
                data.get("time_start"),
                data.get("time_end"),
                data.get("room"),
                data.get("professor")
            ))
            conn.commit()
            print(f"Agent logged class: {data.get('subject')} on day {data.get('day_of_week')}")
            
        elif action_type == "COMPLETE_DEADLINE":
            cursor.execute("""
            UPDATE deadlines
            SET status = 'DONE'
            WHERE user_id = ? AND LOWER(title) LIKE ?
            """, (user_id, f"%{data.get('title', '').lower()}%"))
            conn.commit()
            print(f"Agent marked deadline complete: {data.get('title')}")
            
        elif action_type == "SPLIT_EXPENSE":
            amount = float(data.get("amount", 0))
            merchant = data.get("merchant", "Unknown")
            people = data.get("people", [])
            
            cursor.execute("""
            INSERT INTO expenses (id, user_id, amount, merchant, category, transacted_at, source, notes)
            VALUES (?, ?, ?, ?, 'CANTEEN', ?, 'MANUAL', ?)
            """, (
                str(uuid.uuid4()),
                user_id,
                amount,
                merchant,
                datetime.now().isoformat(),
                f"Expense (Total ₹{amount:.2f} split with {', '.join(people)})"
            ))
            conn.commit()
            print(f"Agent logged expense (full raw amount split): Rs. {amount:.2f} at {merchant}")
            
    except Exception as e:
        print(f"Error executing agent database action: {e}")
    finally:
        conn.close()


def parse_audio_lecture(audio_bytes, mime_type="audio/mp3", duration_ms=None):
    try:
        model = get_gemini_model()
        duration_context = ""
        if duration_ms is not None:
            duration_context = f"\nNote: The user recorded this audio for {float(duration_ms) / 1000:.1f} seconds.\n"
            
        prompt = f"""
        Analyze this student audio recording. It could be either:
        1. A "query": A short conversational command, question, or query directed to the Kora AI assistant (e.g. "What classes do I have tomorrow?", "Add a homework task due Friday", "Log lunch expense of 100 rupees", "Explain what React hooks are").
        2. A "lecture": A longer lecture recording or academic dictation/study content (e.g. describing math concepts, programming variables, biology cell structure).
        {duration_context}
        CRITICAL INSTRUCTIONS FOR SILENCE OR NOISE:
        If the audio contains no clear spoken words (is completely silent, contains only static/clicks/rustling, or has no speech), you MUST return:
        {{
          "type": "query",
          "transcription": ""
        }}
        Do NOT copy example text (like "What classes do I have tomorrow?") when the audio is silent or unintelligible. Return transcription as an empty string.

        First, classify the type of audio.
        Return ONLY a valid JSON object containing:
        - type: The classification string, either "query" or "lecture".
        - transcription: The exact transcription text of the spoken command/question (mandatory if type is "query", optional if type is "lecture").
        - summary: A concise summary of the lecture key concepts (max 100 words) (only if type is "lecture").
        - subject: The academic subject name (e.g. "Math", "Computer Science", "Physics") (only if type is "lecture").
        - flashcards: A list of study cards. Each card must be an object with (only if type is "lecture"):
          - front: Question, concept name, or flashcard front text
          - back: Answer, explanation, or flashcard back text
          - subject: Course subject name
        - deadlines: A list of assignments, exams, or quizzes mentioned in the audio. Each must have (only if type is "lecture"):
          - title: What is the assignment / exam (e.g. "Homework 3 on Integrals", "Chemistry Lab Report")
          - due_at: Due date in YYYY-MM-DD format. If no date is given, guess based on context or leave empty.

        Format examples:
        - For a query:
        {{
          "type": "query",
          "transcription": "What classes do I have tomorrow?"
        }}
        
        - For a lecture:
        {{
          "type": "lecture",
          "summary": "Introduction to React Native Hooks...",
          "subject": "CS",
          "flashcards": [
            {{"front": "What is useState?", "back": "A hook that lets you add state to functional components.", "subject": "CS"}}
          ],
          "deadlines": [
            {{"title": "Homework 3 on Hooks", "due_at": "2026-06-11"}}
          ]
        }}
        
        Ensure the JSON is strictly valid. Do not write markdown formatting outside of a ```json ``` block.
        """
        
        contents = [
            {
                'mime_type': mime_type,
                'data': audio_bytes
            },
            prompt
        ]
        
        response = model.generate_content(contents)
        text = response.text.strip()
        
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
            
        return json.loads(text)
    except Exception as e:
        print(f"Gemini API error in parse_audio_lecture: {e}. Running local fallback...")
        return {
            "type": "query",
            "transcription": "", # local fallback returns empty transcription (silent)
            "summary": "Audio processed locally (Local Fallback)",
            "subject": "General",
            "flashcards": [],
            "deadlines": []
        }


def parse_itemized_receipt(image_bytes, mime_type="image/jpeg"):
    try:
        model = get_gemini_model()
        prompt = """
        Analyze this receipt image.
        Extract the transaction metadata and every individual line item.
        Return ONLY a valid JSON object containing:
        - merchant: Name of the vendor (e.g. "Canteen", "Starbucks", "Mess")
        - total: Total transaction amount as a numeric float/integer
        - category: Must be one of: "MESS", "CANTEEN", "TRANSPORT", "BOOKS", "ENTERTAINMENT", "STATIONARY", "OTHER"
        - items: A list of individual purchase items. Each item must have:
          - name: Short descriptive item name (e.g. "Paneer Roll", "Notebook")
          - price: Price of this item line (as a float/integer)
          - quantity: Quantity purchased (integer)
        
        Ensure the JSON is strictly valid. Do not write markdown formatting outside of a ```json ``` block.
        """
        
        contents = [
            {
                'mime_type': mime_type,
                'data': image_bytes
            },
            prompt
        ]
        
        response = model.generate_content(contents)
        text = response.text.strip()
        
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
            
        return json.loads(text)
    except Exception as e:
        print(f"Gemini API error in parse_itemized_receipt: {e}. Running local fallback...")
        return {
            "merchant": "Canteen (Local Fallback)",
            "total": 150.0,
            "category": "CANTEEN",
            "items": [
                {"name": "Simulated Canteen Receipt Item", "price": 150.0, "quantity": 1}
            ]
        }

def predict_grades_and_weak_spots(user_profile, study_history, attendance):
    try:
        model = get_gemini_model()
        prompt = f"""
        You are Kora, the student life OS AI. Analyze this student's context:
        User Profile: {json.dumps(user_profile)}
        Study History (Spaced Repetition logs): {json.dumps(study_history)}
        Attendance Record: {json.dumps(attendance)}
        
        Predict their semester letter grades (e.g., A, B, C, D, F) with probabilities for each subject, estimate memory strength (0-100) based on review logs and ratings (1=Hard, 2=Medium, 3=Easy), and identify weak spots/recommended study topics.
        
        Return ONLY a valid JSON object matching this schema:
        {{
          "subjects": [
            {{
              "subject": "Name of Subject",
              "predicted_grade": "A-",
              "probability": 78,
              "memory_strength": 82,
              "weak_spots": ["Topic A", "Topic B"],
              "recommended_action": "Review flashcards for Topic A tonight to boost retention."
            }}
          ],
          "overall_gpa_prediction": 8.5
        }}
        
        Ensure the JSON is strictly valid. Do not write markdown formatting outside of a ```json ``` block.
        """
        response = model.generate_content(prompt)
        text = response.text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        return json.loads(text)
    except Exception as e:
        print(f"Gemini API error in predict_grades_and_weak_spots: {e}. Running local fallback...")
        # Rule-based fallback
        subjects = list(set([a["subject"] for a in attendance]))
        if not subjects:
            subjects = ["Computer Science", "Mathematics"]
            
        subject_reports = []
        for sub in subjects:
            # Simple calculations
            att_percent = 80
            for att in attendance:
                if att["subject"].lower() == sub.lower():
                    total = att["present"] + att["absent"]
                    att_percent = (att["present"] / total * 100) if total > 0 else 80
            
            # memory strength
            mem = 75
            if att_percent < 75:
                grade = "B-"
                prob = 65
                weak = ["Attendance Margin", "Class Lectures"]
                action = "Attend next 3 classes to cross 75% attendance threshold!"
            else:
                grade = "A-"
                prob = 80
                weak = ["Exam Prep", "Formula Recall"]
                action = "Keep reviewing flashcards to lock in your A!"
            subject_reports.append({
                "subject": sub,
                "predicted_grade": grade,
                "probability": prob,
                "memory_strength": mem,
                "weak_spots": weak,
                "recommended_action": action
            })
            
        return {
            "subjects": subject_reports,
            "overall_gpa_prediction": 8.5
        }

def generate_weekly_financial_audit(expenses):
    try:
        model = get_gemini_model()
        prompt = f"""
        You are Kora, a funny, witty, slightly sarcastic personal finance assistant for college students.
        Here is the student's recent transaction history:
        {json.dumps(expenses)}
        
        Analyze their spending. Identify if they are spending too much on "CANTEEN", "ENTERTAINMENT", etc.
        Write a short (2-3 paragraphs), humorous, critique of their financial status. Refer to specific merchants or categories they spent on. Deliver witty, helpful advice (e.g. "Dial back the corporate caffeine habits", "Karan Verma owes you Rs 500, time to send a repo man").
        
        Keep the critique engaging and funny. Avoid sounding like a generic banking app.
        Return your raw text critique.
        """
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        print(f"Gemini API error in generate_weekly_financial_audit: {e}. Running local fallback...")
        # Local fallback
        total_spent = sum(e["amount"] for e in expenses)
        canteen_spent = sum(e["amount"] for e in expenses if e["category"] == "CANTEEN")
        
        if total_spent == 0:
            return "Wow, ₹0 spent! You're surviving entirely on stolen hostel snacks. Keep it up, your wallet is crying tears of joy."
        
        ratio = (canteen_spent / total_spent * 100) if total_spent > 0 else 0
        return f"Weekly financial breakdown: You spent ₹{total_spent:.0f} in total. Of that, ₹{canteen_spent:.0f} ({ratio:.1f}%) went straight to Canteen purchases. Seriously, dial back the corporate caffeine habits and cheap snacks! At this rate, your local tea tapri owner is going to buy a second car before you pay off your library fines."


def upsert_memory_node(user_id, type_str, title, source, file_path, summary):
    conn = get_db_connection()
    cursor = conn.cursor()
    # Check if exists
    cursor.execute("SELECT id FROM memory_nodes WHERE user_id = ? AND type = ? AND title = ?", (user_id, type_str, title))
    row = cursor.fetchone()
    if row:
        node_id = row["id"]
        cursor.execute("""
        UPDATE memory_nodes
        SET file_path = ?, summary = ?, last_updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, (file_path, summary, node_id))
    else:
        node_id = str(uuid.uuid4())
        cursor.execute("""
        INSERT INTO memory_nodes (id, user_id, type, title, source, file_path, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (node_id, user_id, type_str, title, source, file_path, summary))
    conn.commit()
    conn.close()
    return node_id


def query_memory_vault(user_id, query_text):
    vault_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "memory_vault")
    if not os.path.exists(vault_dir):
        return ""
        
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT title, file_path, summary FROM memory_nodes WHERE user_id = ?", (user_id,))
    nodes = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    if not nodes:
        return ""
        
    # Match query words with node title/summary/content to retrieve relevant memory context
    query_words = [w.lower() for w in re.findall(r'\w+', query_text) if len(w) > 3]
    if not query_words:
        # Fallback to daily digest if no specific keywords
        query_words = ["digest", "today", "daily"]
        
    relevant_contexts = []
    
    # Search for matching nodes
    for node in nodes:
        title_lower = node["title"].lower()
        summary_lower = (node["summary"] or "").lower()
        
        match_score = 0
        for word in query_words:
            if word in title_lower:
                match_score += 3
            if word in summary_lower:
                match_score += 1
                
        # Read the file to do deep keyword match
        full_path = os.path.join(vault_dir, node["file_path"].replace("/", os.sep))
        file_content = ""
        if os.path.exists(full_path):
            try:
                with open(full_path, "r", encoding="utf-8") as f:
                    file_content = f.read()
                # Keyword search inside content
                content_lower = file_content.lower()
                for word in query_words:
                    if word in content_lower:
                        match_score += 2
            except Exception:
                pass
                
        if match_score >= 2: # Found a match
            relevant_contexts.append({
                "title": node["title"],
                "file_path": node["file_path"],
                "content": file_content or node["summary"],
                "score": match_score
            })
            
    # Sort by score and take top 3
    relevant_contexts.sort(key=lambda x: x["score"], reverse=True)
    top_matches = relevant_contexts[:3]
    
    if not top_matches:
        return ""
        
    context_str = "\n\n--- Long-Term Memory (Second Brain Context) ---\n"
    for match in top_matches:
        context_str += f"\n### Memory: {match['title']} ({match['file_path']})\n{match['content']}\n"
    context_str += "\n--------------------------------------------\n"
    return context_str


def run_memory_indexer(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Fetch data
    # Chats
    cursor.execute("SELECT sender, text, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", (user_id,))
    chats = [dict(r) for r in cursor.fetchall()]
    chats.reverse()
    
    # Expenses
    cursor.execute("SELECT amount, merchant, category, transacted_at, notes FROM expenses WHERE user_id = ? ORDER BY transacted_at DESC LIMIT 30", (user_id,))
    expenses = [dict(r) for r in cursor.fetchall()]
    
    # Deadlines
    cursor.execute("SELECT title, due_at, subject, type, status FROM deadlines WHERE user_id = ? ORDER BY due_at DESC LIMIT 30", (user_id,))
    deadlines = [dict(r) for r in cursor.fetchall()]
    
    # Lecture notes
    cursor.execute("SELECT subject, title, summary, created_at FROM lecture_notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 20", (user_id,))
    notes = [dict(r) for r in cursor.fetchall()]
    
    conn.close()
    
    # Format all data as context
    recent_activity = {
        "chat_logs": chats,
        "expenses": expenses,
        "deadlines": deadlines,
        "lecture_notes": notes,
        "current_time": datetime.now().isoformat()
    }
    
    activity_str = json.dumps(recent_activity, indent=2)
    
    model = get_gemini_model()
    vault_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "memory_vault")
    
    # A. SOURCE TREES
    # 1. WhatsApp & App Chats
    try:
        chat_prompt = f"""
        Summarize the following chat history into a structured Markdown document.
        Separate WhatsApp forwards/notifications from direct Kora app chats.
        Highlight any tasks, follow-ups, or split bill agreements mentioned.
        
        Chat Logs:
        {json.dumps(chats, indent=2)}
        
        Return ONLY the raw Markdown content. No backticks or other decorations.
        """
        chat_md = model.generate_content(chat_prompt).text.strip()
        # strip markdown fence just in case
        if "```markdown" in chat_md:
            chat_md = chat_md.split("```markdown")[1].split("```")[0].strip()
        elif "```" in chat_md:
            chat_md = chat_md.split("```")[1].split("```")[0].strip()
            
        chat_path = os.path.join(vault_dir, "source_trees", "chat_history.md")
        with open(chat_path, "w", encoding="utf-8") as f:
            f.write(chat_md)
        upsert_memory_node(user_id, "source_tree", "Chat & WhatsApp History", "chat", "source_trees/chat_history.md", chat_md[:200])
    except Exception as e:
        print("Indexer error for chat history source:", e)
        
    # 2. Expense Ledger
    try:
        exp_prompt = f"""
        Convert the following student expenses list into a clean, human-readable markdown ledger.
        Highlight total spent, highest merchants, and categorizations.
        
        Expenses:
        {json.dumps(expenses, indent=2)}
        
        Return ONLY the raw Markdown content. No backticks or other decorations.
        """
        exp_md = model.generate_content(exp_prompt).text.strip()
        if "```markdown" in exp_md:
            exp_md = exp_md.split("```markdown")[1].split("```")[0].strip()
        elif "```" in exp_md:
            exp_md = exp_md.split("```")[1].split("```")[0].strip()
            
        exp_path = os.path.join(vault_dir, "source_trees", "expense_ledger.md")
        with open(exp_path, "w", encoding="utf-8") as f:
            f.write(exp_md)
        upsert_memory_node(user_id, "source_tree", "Expense Ledger", "expenses", "source_trees/expense_ledger.md", exp_md[:200])
    except Exception as e:
        print("Indexer error for expense ledger source:", e)

    # 3. Academic & Notes
    try:
        acad_prompt = f"""
        Compile the following deadlines and lecture notes into a structured academic dashboard markdown page.
        Organize by subject. List upcoming exams/assignments and summary topics.
        
        Deadlines: {json.dumps(deadlines, indent=2)}
        Lecture Notes: {json.dumps(notes, indent=2)}
        
        Return ONLY the raw Markdown content. No backticks or other decorations.
        """
        acad_md = model.generate_content(acad_prompt).text.strip()
        if "```markdown" in acad_md:
            acad_md = acad_md.split("```markdown")[1].split("```")[0].strip()
        elif "```" in acad_md:
            acad_md = acad_md.split("```")[1].split("```")[0].strip()
            
        acad_path = os.path.join(vault_dir, "source_trees", "academic_notes.md")
        with open(acad_path, "w", encoding="utf-8") as f:
            f.write(acad_md)
        upsert_memory_node(user_id, "source_tree", "Academic & Deadlines Log", "notes", "source_trees/academic_notes.md", acad_md[:200])
    except Exception as e:
        print("Indexer error for academic log source:", e)

    # B. TOPIC TREES (Lazy entity trees)
    try:
        topic_prompt = f"""
        Analyze the following recent student records:
        Chats, Expenses, Deadlines, and Notes:
        {activity_str}
        
        Identify key entities (specific courses/subjects like "Math" or "DSA", friends/people like "Arjun" or "Karan", specific vendors like "Canteen" or "Starbucks", or key active projects).
        For each entity, output a concise markdown summary detailing what Kora knows about it based on the recent activities.
        Return ONLY a valid JSON list of objects:
        [
          {{"entity": "EntityName", "summary": "One-sentence summary", "markdown_content": "### EntityName\\nDetailed bullet points..."}}
        ]
        Ensure the JSON is strictly valid. Do not write markdown formatting outside of a ```json ``` block.
        """
        resp_text = model.generate_content(topic_prompt).text.strip()
        if "```json" in resp_text:
            resp_text = resp_text.split("```json")[1].split("```")[0].strip()
        elif "```" in resp_text:
            resp_text = resp_text.split("```")[1].split("```")[0].strip()
            
        topics = json.loads(resp_text)
        for t in topics:
            entity_name = t.get("entity", "").strip()
            if not entity_name:
                continue
            safe_name = re.sub(r'[^a-zA-Z0-9_]', '_', entity_name)
            content = t.get("markdown_content", "").strip()
            summary = t.get("summary", "").strip()
            
            topic_file_path = os.path.join(vault_dir, "topic_trees", f"{safe_name}.md")
            # If exists, read existing and merge/update using Gemini
            if os.path.exists(topic_file_path):
                with open(topic_file_path, "r", encoding="utf-8") as f:
                    old_content = f.read()
                merge_prompt = f"""
                You are Kora's memory indexer. We have an existing knowledge base page for the topic '{entity_name}':
                
                --- Existing Content ---
                {old_content}
                
                --- New Updates ---
                {content}
                
                Merge these two documents cleanly. Eliminate duplicates, preserve historical context, and structure the output into a single beautiful Markdown document.
                Return ONLY the raw Markdown content. No backticks or other decorations.
                """
                merged_md = model.generate_content(merge_prompt).text.strip()
                if "```markdown" in merged_md:
                    merged_md = merged_md.split("```markdown")[1].split("```")[0].strip()
                elif "```" in merged_md:
                    merged_md = merged_md.split("```")[1].split("```")[0].strip()
                content = merged_md
                
            with open(topic_file_path, "w", encoding="utf-8") as f:
                f.write(content)
                
            upsert_memory_node(user_id, "topic_tree", f"Topic: {entity_name}", None, f"topic_trees/{safe_name}.md", summary)
    except Exception as e:
        print("Indexer error for topic trees:", e)

    # C. GLOBAL TREES (Daily Digest)
    try:
        today_str = datetime.now().strftime("%Y-%m-%d")
        digest_prompt = f"""
        Summarize the student's day for {today_str} based on this activity log.
        Highlight total spending today, completed tasks, new deadlines added, and class sessions.
        Write a friendly, encouraging daily digest.
        
        Recent Activity:
        {activity_str}
        
        Return ONLY the raw Markdown content. No backticks or other decorations.
        """
        digest_md = model.generate_content(digest_prompt).text.strip()
        if "```markdown" in digest_md:
            digest_md = digest_md.split("```markdown")[1].split("```")[0].strip()
        elif "```" in digest_md:
            digest_md = digest_md.split("```")[1].split("```")[0].strip()
            
        digest_file_name = f"daily_digest_{today_str}.md"
        digest_path = os.path.join(vault_dir, "global_trees", digest_file_name)
        with open(digest_path, "w", encoding="utf-8") as f:
            f.write(digest_md)
        upsert_memory_node(user_id, "global_tree", f"Daily Digest: {today_str}", None, f"global_trees/{digest_file_name}", digest_md[:200])
    except Exception as e:
        print("Indexer error for daily digest:", e)

    return True
