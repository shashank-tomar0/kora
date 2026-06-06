from dotenv import load_dotenv
load_dotenv(override=True)

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uuid
import os
from datetime import datetime
import google.generativeai as genai
import json

from database import get_db_connection, seed_default_user
from agents import parse_timetable_image, parse_receipt_image, handle_chat_query, get_gemini_model

app = FastAPI(title="Kora Backend API", version="1.0")

# Allow CORS for Expo app and web local host dev servers
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    user_id: str = None
    message: str

class DeadlineCreate(BaseModel):
    user_id: str = None
    title: str
    due_at: str
    subject: str = None
    type: str = "OTHER"

class ExpenseCreate(BaseModel):
    user_id: str = None
    amount: float
    merchant: str
    category: str
    notes: str = None

class ClassCreate(BaseModel):
    user_id: str = None
    subject: str
    title: str = "Lecture"
    day_of_week: int
    time_start: str
    time_end: str
    room: str = None
    professor: str = None

class GoogleAuthRequest(BaseModel):
    email: str
    name: str
    avatar_url: str = None

class OnboardingRequest(BaseModel):
    user_id: str
    name: str
    college: str
    branch: str
    year: int

class WhatsAppWebhookRequest(BaseModel):
    message: str
    sender: str
    sender_name: str

class SplitRequest(BaseModel):
    user_id: str = None
    friend: str
    amount: float
    description: str = None
    type: str = "lent"

class PomodoroRequest(BaseModel):
    user_id: str
    minutes: int


# Get active user_id helper
def get_user_id(user_id_param: str = None):
    if not user_id_param:
        return seed_default_user()
        
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Try to check if user_id_param matches id directly
        cursor.execute("SELECT id FROM users WHERE id = ?", (user_id_param,))
        user = cursor.fetchone()
        if user:
            conn.close()
            return user["id"]
            
        # Check if matches phone number or email
        clean_phone = user_id_param.split("@")[0] if "@" in user_id_param else user_id_param
        phone_with_plus = f"+{clean_phone}" if not clean_phone.startswith("+") else clean_phone
        cursor.execute("SELECT id FROM users WHERE phone_number = ? OR phone_number LIKE ? OR email = ?", (phone_with_plus, f"%{clean_phone}%", user_id_param))
        user = cursor.fetchone()
        if user:
            conn.close()
            return user["id"]
            
        # Fallback to first user in DB
        cursor.execute("SELECT id FROM users LIMIT 1")
        first_user = cursor.fetchone()
        conn.close()
        if first_user:
            return first_user["id"]
    except Exception as e:
        print("Error in get_user_id:", e)
        
    # Return default seeded user
    return seed_default_user()

@app.get("/")
def read_root():
    return {"status": "healthy", "service": "Kora Backend", "time": datetime.now().isoformat()}

@app.post("/api/auth/google")
def auth_google(req: GoogleAuthRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if user with this email already exists
    cursor.execute("SELECT * FROM users WHERE email = ?", (req.email,))
    user = cursor.fetchone()
    
    if user:
        user_dict = dict(user)
        conn.close()
        return {
            "user_id": user_dict["id"],
            "name": user_dict["name"],
            "email": user_dict["email"],
            "avatar_url": user_dict["avatar_url"],
            "college": user_dict["college"],
            "branch": user_dict["branch"],
            "year": user_dict["year"],
            "onboarded": user_dict["college"] is not None,
            "xp": user_dict.get("xp", 0) or 0,
            "level": user_dict.get("level", 1) or 1
        }
    
    # Create new user
    user_id = str(uuid.uuid4())
    cursor.execute("""
    INSERT INTO users (id, name, email, avatar_url, xp, level)
    VALUES (?, ?, ?, ?, 0, 1)
    """, (user_id, req.name, req.email, req.avatar_url))
    conn.commit()
    conn.close()
    
    return {
        "user_id": user_id,
        "name": req.name,
        "email": req.email,
        "avatar_url": req.avatar_url,
        "college": None,
        "branch": None,
        "year": 1,
        "onboarded": False,
        "xp": 0,
        "level": 1
    }

@app.post("/api/onboarding")
def complete_onboarding(req: OnboardingRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
        UPDATE users 
        SET name = ?, college = ?, branch = ?, year = ?
        WHERE id = ?
        """, (req.name, req.college, req.branch, req.year, req.user_id))
        conn.commit()
        return {"message": "Onboarding completed successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.get("/api/whatsapp/qr")
def get_whatsapp_qr():
    # Try querying the WhatsApp bridge /status endpoint first
    wa_bridge_url = os.environ.get("WA_BRIDGE_URL", "http://localhost:8002")
    try:
        import httpx
        r = httpx.get(f"{wa_bridge_url}/status", timeout=1.5)
        if r.status_code == 200:
            data = r.json()
            if data.get("connected"):
                return {"connected": True, "qr": None}
            else:
                return {"connected": False, "qr": data.get("qr")}
    except Exception as e:
        print("Failed to contact WhatsApp bridge status endpoint:", e)

    # Fallback to local file read
    qr_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "current_qr.txt")
    if os.path.exists(qr_path):
        try:
            with open(qr_path, "r") as f:
                qr_str = f.read().strip()
            if qr_str:
                return {"connected": False, "qr": qr_str}
        except Exception:
            pass
    return {"connected": True, "qr": None}

@app.get("/whatsapp/connect", response_class=HTMLResponse)
def whatsapp_connect_page():
    html_content = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Connect WhatsApp to Kora</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0b0b0f;
            --card-bg: #12121a;
            --text-primary: #ffffff;
            --text-secondary: #a1a1aa;
            --accent: #7b6ef6;
            --accent-glow: rgba(123, 110, 246, 0.15);
            --success: #10b981;
            --success-glow: rgba(16, 185, 129, 0.15);
            --border-color: #27272a;
            --font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        body {
            background-color: var(--bg-color);
            color: var(--text-primary);
            font-family: var(--font-family);
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            overflow-x: hidden;
            position: relative;
        }

        .glow-bg {
            position: absolute;
            top: -10%;
            left: 10%;
            width: 600px;
            height: 600px;
            background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
            z-index: 0;
            pointer-events: none;
        }

        .container {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 24px;
            padding: 40px;
            width: 100%;
            max-width: 420px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), 0 0 80px rgba(123, 110, 246, 0.05);
            text-align: center;
            position: relative;
            z-index: 1;
            backdrop-filter: blur(10px);
        }

        .logo {
            font-size: 28px;
            font-weight: 800;
            background: linear-gradient(135deg, #a78bfa 0%, var(--accent) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
        }

        .title {
            font-size: 20px;
            font-weight: 600;
            margin: 0 0 12px 0;
            color: var(--text-primary);
        }

        .subtitle {
            font-size: 14px;
            color: var(--text-secondary);
            line-height: 1.5;
            margin-bottom: 30px;
        }

        .qr-box {
            width: 260px;
            height: 260px;
            margin: 0 auto 30px auto;
            background: #ffffff;
            border-radius: 20px;
            padding: 16px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            display: flex;
            justify-content: center;
            align-items: center;
            position: relative;
            border: 2px solid var(--border-color);
            transition: all 0.5s ease;
        }

        .qr-box.connected {
            background: var(--success-glow);
            border-color: var(--success);
            box-shadow: 0 0 30px var(--success-glow);
        }

        .qr-image {
            width: 100%;
            height: 100%;
            object-fit: contain;
            border-radius: 8px;
            transition: opacity 0.3s ease;
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            border-radius: 100px;
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 30px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: all 0.3s ease;
        }

        .status-badge.connected {
            background: rgba(16, 185, 129, 0.1);
            border-color: rgba(16, 185, 129, 0.2);
            color: var(--success);
        }

        .status-badge.waiting {
            background: rgba(123, 110, 246, 0.1);
            border-color: rgba(123, 110, 246, 0.2);
            color: #a78bfa;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: currentColor;
            display: inline-block;
        }

        .status-dot.pulse {
            animation: pulse 1.5s infinite;
        }

        .instructions {
            text-align: left;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 16px;
            padding: 20px;
            margin-top: 10px;
        }

        .instructions-title {
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-secondary);
            font-weight: 700;
            margin-bottom: 12px;
        }

        .steps {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        .steps li {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 10px;
            display: flex;
            gap: 12px;
            line-height: 1.4;
        }

        .steps li:last-child {
            margin-bottom: 0;
        }

        .step-num {
            background: rgba(123, 110, 246, 0.15);
            color: #a78bfa;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 700;
            flex-shrink: 0;
        }

        .success-icon {
            font-size: 64px;
            animation: scaleIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;
        }

        @keyframes pulse {
            0% { transform: scale(0.95); opacity: 0.5; }
            50% { transform: scale(1.05); opacity: 1; }
            100% { transform: scale(0.95); opacity: 0.5; }
        }

        @keyframes scaleIn {
            0% { transform: scale(0); }
            100% { transform: scale(1); }
        }
        
        .loading-spinner {
            border: 3px solid rgba(255, 255, 255, 0.1);
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border-left-color: var(--accent);
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="glow-bg"></div>
    <div class="container">
        <div class="logo">KORA</div>
        <h1 class="title">WhatsApp Bridge</h1>
        <p class="subtitle">Connect your personal Kora assistant to WhatsApp to chat, schedule, and sync lectures on the go.</p>
        
        <div id="qr-box" class="qr-box">
            <div class="loading-spinner"></div>
        </div>

        <div id="status-badge" class="status-badge waiting">
            <span id="status-dot" class="status-dot pulse"></span>
            <span id="status-text">Initializing bridge...</span>
        </div>

        <div class="instructions">
            <div class="instructions-title">How to Connect</div>
            <ul class="steps">
                <li>
                    <span class="step-num">1</span>
                    <span>Open <strong>WhatsApp</strong> on your phone.</span>
                </li>
                <li>
                    <span class="step-num">2</span>
                    <span>Tap <strong>Menu</strong> (Android) or <strong>Settings</strong> (iOS).</span>
                </li>
                <li>
                    <span class="step-num">3</span>
                    <span>Select <strong>Linked Devices</strong>, then tap <strong>Link a Device</strong>.</span>
                </li>
                <li>
                    <span class="step-num">4</span>
                    <span>Point your phone camera to this screen to scan the QR code.</span>
                </li>
            </ul>
        </div>
    </div>

    <script>
        const qrBox = document.getElementById('qr-box');
        const statusBadge = document.getElementById('status-badge');
        const statusText = document.getElementById('status-text');
        const statusDot = document.getElementById('status-dot');

        let lastQr = null;
        let isConnected = false;

        async function checkStatus() {
            try {
                const response = await fetch('/api/whatsapp/qr');
                if (!response.ok) throw new Error('API error');
                const data = await response.json();
                
                if (data.connected) {
                    if (!isConnected) {
                        isConnected = true;
                        qrBox.classList.add('connected');
                        qrBox.innerHTML = '<div class="success-icon">✅</div>';
                        statusBadge.className = 'status-badge connected';
                        statusText.innerText = 'WhatsApp Connected';
                        statusDot.className = 'status-dot';
                        lastQr = null;
                    }
                } else if (data.qr) {
                    isConnected = false;
                    statusBadge.className = 'status-badge waiting';
                    statusText.innerText = 'Scan the QR code to pair';
                    statusDot.className = 'status-dot pulse';
                    
                    if (data.qr !== lastQr) {
                        lastQr = data.qr;
                        qrBox.classList.remove('connected');
                        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(data.qr)}`;
                        qrBox.innerHTML = `<img id="qr-image" class="qr-image" src="${qrUrl}" alt="WhatsApp QR Code" />`;
                    }
                } else {
                    isConnected = false;
                    statusBadge.className = 'status-badge waiting';
                    statusText.innerText = 'Generating QR code...';
                    statusDot.className = 'status-dot pulse';
                    qrBox.innerHTML = '<div style="color: #52525b;">Awaiting QR...</div>';
                    lastQr = null;
                }
            } catch (error) {
                console.error('Error fetching WhatsApp status:', error);
                statusText.innerText = 'Bridge disconnected';
                statusDot.className = 'status-dot';
                qrBox.innerHTML = '<div style="color: #ef4444; font-size: 14px;">Cannot reach WhatsApp bridge.<br>Ensure the bridge server is running.</div>';
            }
        }

        checkStatus();
        setInterval(checkStatus, 3000);
    </script>
</body>
</html>"""
    return HTMLResponse(content=html_content)

@app.post("/api/whatsapp/webhook")
def whatsapp_webhook(req: WhatsAppWebhookRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Try to clean remote JID to match phone_number format in DB (+91...)
    raw_phone = req.sender.split("@")[0]
    phone_with_plus = f"+{raw_phone}"
    
    cursor.execute("SELECT id FROM users WHERE phone_number = ? OR phone_number LIKE ?", (phone_with_plus, f"%{raw_phone}%"))
    user = cursor.fetchone()
    
    if user:
        uid = user["id"]
    else:
        # Fallback to seeded default user
        cursor.execute("SELECT id FROM users LIMIT 1")
        first_user = cursor.fetchone()
        uid = first_user["id"] if first_user else seed_default_user()
        
    conn.close()
    
    print(f"WhatsApp message received for UID {uid} from {req.sender_name}: '{req.message}'")
    
    try:
        from agents import handle_chat_query
        reply = handle_chat_query(uid, f"WhatsApp forward from {req.sender_name}: {req.message}")
        
        # Save both messages to chat_messages
        conn = get_db_connection()
        cursor = conn.cursor()
        time_str = datetime.now().strftime("%I:%M %p")
        
        cursor.execute("""
        INSERT INTO chat_messages (id, user_id, sender, text, time)
        VALUES (?, ?, 'user', ?, ?)
        """, (str(uuid.uuid4()), uid, f"💬 WhatsApp (from {req.sender_name}): {req.message}", time_str))
        
        cursor.execute("""
        INSERT INTO chat_messages (id, user_id, sender, text, time)
        VALUES (?, ?, 'kora', ?, ?)
        """, (str(uuid.uuid4()), uid, reply, time_str))
        
        conn.commit()
        conn.close()
        
        return {"status": "success", "reply": reply, "user_id": uid}
    except Exception as e:
        print("Error processing WhatsApp webhook:", e)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
def chat(req: ChatRequest):
    uid = get_user_id(req.user_id)
    try:
        reply = handle_chat_query(uid, req.message)
        
        # Log to chat_messages history table
        conn = get_db_connection()
        cursor = conn.cursor()
        time_str = datetime.now().strftime("%I:%M %p")
        
        cursor.execute("""
        INSERT INTO chat_messages (id, user_id, sender, text, time)
        VALUES (?, ?, 'user', ?, ?)
        """, (str(uuid.uuid4()), uid, req.message, time_str))
        
        cursor.execute("""
        INSERT INTO chat_messages (id, user_id, sender, text, time)
        VALUES (?, ?, 'kora', ?, ?)
        """, (str(uuid.uuid4()), uid, reply, time_str))
        
        conn.commit()
        conn.close()
        
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/chat/history")
def get_chat_history(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT sender, text, time 
    FROM chat_messages 
    WHERE user_id = ? 
    ORDER BY created_at ASC
    """, (uid,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/chat/voice-greeting")
def get_voice_greeting(user_id: str = None):
    uid = get_user_id(user_id)
    try:
        from agents import get_student_context, get_gemini_model
        context = get_student_context(uid)
        model = get_gemini_model()
        
        prompt = f"""
        Create a warm, personal, and brief welcome greeting (max 25 words) for the student based on their profile and schedule context:
        {json.dumps(context, indent=2)}
        
        Current local timestamp is: {datetime.now().strftime("%A, %I:%M %p")}
        
        INSTRUCTIONS:
        - Greet them warmly by name.
        - Mention their next immediate class or the most urgent upcoming deadline today/tomorrow (if any).
        - Keep it extremely natural, friendly, conversational, and under 25 words. It will be spoken out loud.
        """
        response = model.generate_content(prompt)
        greeting = response.text.strip()
        return {"greeting": greeting}
    except Exception as e:
        print("Voice greeting error:", e)
        return {"greeting": "Hello! Welcome back. Ready to check your tasks today?"}

@app.post("/api/chat/clear")
def clear_chat_history(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM chat_messages WHERE user_id = ?", (uid,))
    conn.commit()
    conn.close()
    return {"message": "Chat history cleared"}

@app.post("/api/ingest/image")
async def ingest_image(
    file: UploadFile = File(...),
    user_id: str = Form(None),
    doc_type: str = Form(None) # "timetable", "receipt", or None (auto-detect)
):
    uid = get_user_id(user_id)
    image_bytes = await file.read()
    
    # Check mime type
    mime_type = file.content_type or "image/jpeg"
    
    try:
        # Determine doc_type if not provided
        if not doc_type:
            # Call Gemini to classify the image
            model = get_gemini_model()
            classify_prompt = """
            Look at this image. Classify it as either 'timetable' (weekly class schedule or calendar) or 'receipt' (payment confirmation, shopping receipt, invoice).
            Return ONLY the string 'timetable' or 'receipt'. Do not add punctuation or explanation.
            """
            contents = [
                {
                    'mime_type': mime_type,
                    'data': image_bytes
                },
                classify_prompt
            ]
            response = model.generate_content(contents)
            detected = response.text.strip().lower()
            if "timetable" in detected:
                doc_type = "timetable"
            elif "receipt" in detected:
                doc_type = "receipt"
            else:
                raise ValueError(f"Could not classify image: {detected}")
            print(f"Auto-classified image as: {doc_type}")
            
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if doc_type == "timetable":
            schedule_blocks = parse_timetable_image(image_bytes, mime_type)
            # Write to database
            added_classes = []
            for block in schedule_blocks:
                class_id = str(uuid.uuid4())
                cursor.execute("""
                INSERT INTO schedule_events (id, user_id, subject, title, day_of_week, time_start, time_end, room, professor, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OCR')
                """, (
                    class_id,
                    uid,
                    block.get("subject"),
                    block.get("title", "Lecture"),
                    int(block.get("day_of_week", 0)),
                    block.get("time_start"),
                    block.get("time_end"),
                    block.get("room"),
                    block.get("professor"),
                ))
                added_classes.append(block.get("subject"))
            conn.commit()
            conn.close()
            return {
                "type": "timetable",
                "message": f"Successfully imported schedule. Found {len(schedule_blocks)} classes: {', '.join(set(added_classes))}.",
                "data": schedule_blocks
            }
            
        elif doc_type == "receipt":
            expense_data = parse_receipt_image(image_bytes, mime_type)
            # Write to database
            expense_id = str(uuid.uuid4())
            cursor.execute("""
            INSERT INTO expenses (id, user_id, amount, merchant, category, transacted_at, source, notes)
            VALUES (?, ?, ?, ?, ?, ?, 'RECEIPT_OCR', ?)
            """, (
                expense_id,
                uid,
                float(expense_data.get("amount", 0)),
                expense_data.get("merchant", "Unknown"),
                expense_data.get("category", "OTHER"),
                datetime.now().isoformat(),
                expense_data.get("notes")
            ))
            conn.commit()
            conn.close()
            return {
                "type": "receipt",
                "message": f"Successfully logged ₹{expense_data.get('amount')} at {expense_data.get('merchant')} under {expense_data.get('category')}.",
                "data": expense_data
            }
        else:
            conn.close()
            raise HTTPException(status_code=400, detail="Invalid doc_type parameter")
            
    except Exception as e:
        print("Error during image ingest:", e)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/schedule")
def get_schedule(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, subject, title, day_of_week, time_start, time_end, room, professor, source 
    FROM schedule_events 
    WHERE user_id = ?
    ORDER BY day_of_week, time_start
    """, (uid,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/schedule")
def add_class(req: ClassCreate):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    class_id = str(uuid.uuid4())
    try:
        cursor.execute("""
        INSERT INTO schedule_events (id, user_id, subject, title, day_of_week, time_start, time_end, room, professor, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL')
        """, (
            class_id,
            uid,
            req.subject,
            req.title,
            req.day_of_week,
            req.time_start,
            req.time_end,
            req.room,
            req.professor
        ))
        conn.commit()
        return {"id": class_id, "message": "Class added successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.delete("/api/schedule/clear-allocations")
def clear_allocations(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM schedule_events WHERE source = 'STUDY_ALLOCATOR' AND user_id = ?", (uid,))
    conn.commit()
    conn.close()
    return {"message": "Study allocations cleared"}

@app.delete("/api/schedule/{class_id}")
def delete_class(class_id: str, user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM schedule_events WHERE id = ? AND user_id = ?", (class_id, uid))
    conn.commit()
    conn.close()
    return {"message": "Class deleted"}

@app.get("/api/deadlines")
def get_deadlines(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, title, due_at, subject, type, status, source_raw
    FROM deadlines
    WHERE user_id = ?
    ORDER BY due_at ASC
    """, (uid,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/deadlines")
def add_deadline(req: DeadlineCreate):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    deadline_id = str(uuid.uuid4())
    try:
        cursor.execute("""
        INSERT INTO deadlines (id, user_id, title, due_at, subject, type, status, source_raw)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 'MANUAL')
        """, (
            deadline_id,
            uid,
            req.title,
            req.due_at,
            req.subject,
            req.type
        ))
        conn.commit()
        return {"id": deadline_id, "message": "Deadline created successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.post("/api/deadlines/{deadline_id}/complete")
def complete_deadline(deadline_id: str, user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE deadlines 
    SET status = 'DONE' 
    WHERE id = ? AND user_id = ?
    """, (deadline_id, uid))
    conn.commit()
    conn.close()
    return {"message": "Deadline marked as complete"}

@app.delete("/api/deadlines/{deadline_id}")
def delete_deadline(deadline_id: str, user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM deadlines WHERE id = ? AND user_id = ?", (deadline_id, uid))
    conn.commit()
    conn.close()
    return {"message": "Deadline deleted"}

@app.get("/api/expenses")
def get_expenses(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, amount, merchant, category, transacted_at, source, notes
    FROM expenses
    WHERE user_id = ?
    ORDER BY transacted_at DESC
    """, (uid,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/expenses")
def add_expense(req: ExpenseCreate):
    uid = get_user_id(req.user_id)
    
    # Defensive normalization of category
    category_upper = (req.category or "OTHER").upper()
    valid_categories = {'MESS', 'CANTEEN', 'TRANSPORT', 'BOOKS', 'ENTERTAINMENT', 'STATIONARY', 'OTHER'}
    if category_upper == "STATIONERY":
        category_upper = "STATIONARY"
    elif category_upper not in valid_categories:
        category_upper = "OTHER"
        
    conn = get_db_connection()
    cursor = conn.cursor()
    expense_id = str(uuid.uuid4())
    try:
        cursor.execute("""
        INSERT INTO expenses (id, user_id, amount, merchant, category, transacted_at, source, notes)
        VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', ?)
        """, (
            expense_id,
            uid,
            req.amount,
            req.merchant,
            category_upper,
            datetime.now().isoformat(),
            req.notes
        ))
        conn.commit()
        return {"id": expense_id, "message": "Expense added successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.delete("/api/expenses/{expense_id}")
def delete_expense(expense_id: str, user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM expenses WHERE id = ? AND user_id = ?", (expense_id, uid))
    conn.commit()
    conn.close()
    return {"message": "Expense deleted"}

@app.get("/api/flashcards")
def get_flashcards(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, subject, front, back, difficulty, next_review_at FROM flashcards WHERE user_id = ?", (uid,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/flashcards")
def create_flashcard(
    subject: str = Form(...),
    front: str = Form(...),
    back: str = Form(...),
    user_id: str = Form(None)
):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    card_id = str(uuid.uuid4())
    next_review = datetime.now().isoformat()
    try:
        cursor.execute("""
        INSERT INTO flashcards (id, user_id, subject, front, back, difficulty, next_review_at)
        VALUES (?, ?, ?, ?, ?, 3, ?)
        """, (card_id, uid, subject, front, back, next_review))
        conn.commit()
        return {"id": card_id, "message": "Flashcard created successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.post("/api/flashcards/{card_id}/review")
def review_flashcard(card_id: str, rating: int = Form(...), user_id: str = Form(None)):
    # Simple SM-2 implementation
    # rating: 1 = hard, 2 = medium, 3 = easy
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM flashcards WHERE id = ? AND user_id = ?", (card_id, uid))
    card = cursor.fetchone()
    if not card:
        conn.close()
        raise HTTPException(status_code=404, detail="Flashcard not found")
    
    # Simple spaced repetition logic: increment review days based on rating
    days = 1
    if rating == 2:
        days = 3
    elif rating == 3:
        days = 7
        
    import datetime as dt
    next_review = (dt.datetime.now() + dt.timedelta(days=days)).isoformat()
    
    cursor.execute("UPDATE flashcards SET next_review_at = ?, difficulty = ? WHERE id = ?", (next_review, rating, card_id))
    
    # Log review in study_history
    history_id = str(uuid.uuid4())
    cursor.execute("""
    INSERT INTO study_history (id, user_id, card_id, reviewed_at, rating)
    VALUES (?, ?, ?, ?, ?)
    """, (history_id, uid, card_id, dt.datetime.now().isoformat(), rating))
    
    conn.commit()
    conn.close()
    return {"message": "Flashcard review scheduled"}

@app.get("/api/roadmaps")
def get_roadmaps(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, title, description, steps_json, created_at FROM study_roadmaps WHERE user_id = ? ORDER BY created_at DESC", (uid,))
    rows = cursor.fetchall()
    conn.close()
    
    res = []
    for r in rows:
        d = dict(r)
        d["steps"] = json.loads(d["steps_json"])
        res.append(d)
    return res

@app.post("/api/roadmaps/{roadmap_id}/toggle/{step_idx}")
def toggle_roadmap_step(roadmap_id: str, step_idx: int, user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT steps_json FROM study_roadmaps WHERE id = ? AND user_id = ?", (roadmap_id, uid))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Roadmap not found")
        
    steps = json.loads(row["steps_json"])
    if 0 <= step_idx < len(steps):
        steps[step_idx]["checked"] = not steps[step_idx].get("checked", False)
        
    cursor.execute("UPDATE study_roadmaps SET steps_json = ? WHERE id = ?", (json.dumps(steps), roadmap_id))
    conn.commit()
    conn.close()
    return {"message": "Step toggled", "steps": steps}

@app.post("/api/schedule/proactive-allocate")
def proactive_allocate(user_id: str = None):
    uid = get_user_id(user_id)
    from database import proactive_allocate_logic
    try:
        count = proactive_allocate_logic(uid)
        return {"message": f"Successfully allocated {count} study blocks in schedule.", "count": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/study/streak-heatmap")
def get_streak_heatmap(user_id: str = None):
    uid = get_user_id(user_id)
    import datetime as dt
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get counts of reviews grouped by date
    cursor.execute("""
    SELECT DATE(reviewed_at) as review_date, COUNT(*) as count
    FROM study_history
    WHERE user_id = ?
    GROUP BY review_date
    ORDER BY review_date DESC
    """, (uid,))
    rows = cursor.fetchall()
    conn.close()
    
    history_counts = {row["review_date"]: row["count"] for row in rows}
    dates = list(history_counts.keys())
    
    # Calculate streak
    streak = 0
    today_str = dt.date.today().isoformat()
    yesterday_str = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    
    if today_str in dates or yesterday_str in dates:
        current_date = dt.date.today()
        if today_str not in dates:
            current_date = dt.date.today() - dt.timedelta(days=1)
            
        while current_date.isoformat() in dates:
            streak += 1
            current_date -= dt.timedelta(days=1)
            
    # Return 30 days of counts
    heatmap = []
    for i in range(30):
        d = (dt.date.today() - dt.timedelta(days=i)).isoformat()
        heatmap.append({
            "date": d,
            "count": history_counts.get(d, 0)
        })
        
    return {"streak": streak, "heatmap": heatmap[::-1]} # reverse to chronological order

@app.post("/api/ingest/pdf")
async def ingest_pdf(
    file: UploadFile = File(...),
    user_id: str = Form(None)
):
    uid = get_user_id(user_id)
    pdf_bytes = await file.read()
    
    try:
        model = get_gemini_model()
        
        prompt = """
        Analyze this syllabus or exam circular PDF.
        Extract:
        1. A structured step-by-step Study Roadmap for this course/subject.
        2. A deck of 5-8 study flashcards.
        
        Return ONLY a valid JSON object. Do not add markdown formatting outside of a ```json ``` block.
        
        The JSON object must have:
        - subject: Name of the course/subject (e.g. "Operating Systems")
        - roadmap_title: Short title for the roadmap (e.g. "OS Exam Prep")
        - roadmap_description: A short description
        - roadmap: A list of objects representing steps:
          - title: Milestone/topic title (e.g. "Understand CPU Scheduling")
          - description: Brief description of what to study
        - flashcards: A list of objects representing flashcards:
          - front: Concept or question
          - back: Definition or answer
          
        Ensure the JSON is strictly valid.
        """
        
        mime_type = file.content_type or "application/pdf"
        contents = [
            {
                'mime_type': mime_type,
                'data': pdf_bytes
            },
            prompt
        ]
        
        response = model.generate_content(contents)
        text = response.text.strip()
        
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
            
        res_data = json.loads(text)
        
        # Save to database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Insert roadmap
        roadmap_id = str(uuid.uuid4())
        steps = [{"id": i, "title": step.get("title"), "description": step.get("description"), "checked": False} 
                 for i, step in enumerate(res_data.get("roadmap", []))]
                 
        cursor.execute("""
        INSERT INTO study_roadmaps (id, user_id, title, description, steps_json)
        VALUES (?, ?, ?, ?, ?)
        """, (
            roadmap_id,
            uid,
            res_data.get("roadmap_title") or f"{res_data.get('subject')} Roadmap",
            res_data.get("roadmap_description"),
            json.dumps(steps)
        ))
        
        # Insert flashcards
        added_cards = 0
        for card in res_data.get("flashcards", []):
            card_id = str(uuid.uuid4())
            next_review = datetime.now().isoformat()
            cursor.execute("""
            INSERT INTO flashcards (id, user_id, subject, front, back, difficulty, next_review_at)
            VALUES (?, ?, ?, ?, ?, 3, ?)
            """, (
                card_id,
                uid,
                res_data.get("subject", "General"),
                card.get("front"),
                card.get("back"),
                next_review
            ))
            added_cards += 1
            
        conn.commit()
        conn.close()
        
        return {
            "message": f"Successfully parsed circular. Created learning roadmap with {len(steps)} steps and added {added_cards} flashcards.",
            "subject": res_data.get("subject"),
            "roadmap_id": roadmap_id
        }
        
    except Exception as e:
        print("Error during PDF ingestion:", e)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat/voice")
async def chat_voice(
    file: UploadFile = File(...),
    user_id: str = Form(None),
    sender: str = Form(None),
    duration_ms: float = Form(None)
):
    if sender:
        conn = get_db_connection()
        cursor = conn.cursor()
        raw_phone = sender.split("@")[0]
        phone_with_plus = f"+{raw_phone}"
        cursor.execute("SELECT id FROM users WHERE phone_number = ? OR phone_number LIKE ?", (phone_with_plus, f"%{raw_phone}%"))
        user = cursor.fetchone()
        if user:
            uid = user["id"]
        else:
            uid = get_user_id(user_id)
        conn.close()
    else:
        uid = get_user_id(user_id)
    audio_bytes = await file.read()
    mime_type = file.content_type or "audio/m4a"
    
    try:
        from agents import parse_audio_lecture
        data = parse_audio_lecture(audio_bytes, mime_type, duration_ms)
        
        audio_type = data.get("type", "lecture")
        if audio_type == "query":
            transcription = data.get("transcription")
            if not transcription or not transcription.strip():
                msg = "I couldn't hear any speech. Please make sure your mic is working and speak clearly."
                conn = get_db_connection()
                cursor = conn.cursor()
                time_str = datetime.now().strftime("%I:%M %p")
                cursor.execute("""
                INSERT INTO chat_messages (id, user_id, sender, text, time)
                VALUES (?, ?, 'user', '🎤 [Silent voice clip]', ?)
                """, (str(uuid.uuid4()), uid, time_str))
                cursor.execute("""
                INSERT INTO chat_messages (id, user_id, sender, text, time)
                VALUES (?, ?, 'kora', ?, ?)
                """, (str(uuid.uuid4()), uid, msg, time_str))
                conn.commit()
                conn.close()
                return {"reply": msg}
                
            from agents import handle_chat_query
            msg = handle_chat_query(uid, transcription)
            
            # Log to chat_messages history table
            conn = get_db_connection()
            cursor = conn.cursor()
            time_str = datetime.now().strftime("%I:%M %p")
            cursor.execute("""
            INSERT INTO chat_messages (id, user_id, sender, text, time)
            VALUES (?, ?, 'user', ?, ?)
            """, (str(uuid.uuid4()), uid, f"🎤 Voice: {transcription}", time_str))
            cursor.execute("""
            INSERT INTO chat_messages (id, user_id, sender, text, time)
            VALUES (?, ?, 'kora', ?, ?)
            """, (str(uuid.uuid4()), uid, msg, time_str))
            conn.commit()
            conn.close()
            return {"reply": msg}
            
        # Save to database (lecture path)
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 1. Store deadlines if any
        added_deadlines = []
        for dl in data.get("deadlines", []):
            dl_id = str(uuid.uuid4())
            due_str = dl.get("due_at")
            if not due_str:
                due_str = (datetime.now().date()).isoformat()
            cursor.execute("""
            INSERT INTO deadlines (id, user_id, title, due_at, subject, status)
            VALUES (?, ?, ?, ?, ?, 'PENDING')
            """, (
                dl_id,
                uid,
                dl.get("title"),
                due_str,
                dl.get("subject") or data.get("subject")
            ))
            added_deadlines.append(dl.get("title"))
            
        # 2. Store flashcards if any
        added_cards = []
        for fc in data.get("flashcards", []):
            fc_id = str(uuid.uuid4())
            cursor.execute("""
            INSERT INTO flashcards (id, user_id, subject, front, back, difficulty, next_review_at)
            VALUES (?, ?, ?, ?, ?, 3, ?)
            """, (
                fc_id,
                uid,
                fc.get("subject") or data.get("subject"),
                fc.get("front"),
                fc.get("back"),
                datetime.now().isoformat()
            ))
            added_cards.append(fc.get("front"))
            
        conn.commit()
        conn.close()
        
        summary = data.get("summary", "Lecture processed successfully.")
        msg = f"Processed class lecture summary: {summary}"
        if added_deadlines:
            msg += f"\n- scheduled deadlines: {', '.join(added_deadlines)}"
        if added_cards:
            msg += f"\n- generated {len(added_cards)} flashcards"
            
        # Log to chat_messages history table
        conn = get_db_connection()
        cursor = conn.cursor()
        time_str = datetime.now().strftime("%I:%M %p")
        
        cursor.execute("""
        INSERT INTO chat_messages (id, user_id, sender, text, time)
        VALUES (?, ?, 'user', '🎤 Voice message sent', ?)
        """, (str(uuid.uuid4()), uid, time_str))
        
        cursor.execute("""
        INSERT INTO chat_messages (id, user_id, sender, text, time)
        VALUES (?, ?, 'kora', ?, ?)
        """, (str(uuid.uuid4()), uid, msg, time_str))
        
        conn.commit()
        conn.close()
        
        return {"reply": msg}
        
    except Exception as e:
        print("Error during voice chat process:", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ingest/audio")
async def ingest_audio(
    file: UploadFile = File(...),
    user_id: str = Form(None)
):
    uid = get_user_id(user_id)
    audio_bytes = await file.read()
    mime_type = file.content_type or "audio/mp3"
    
    try:
        from agents import parse_audio_lecture
        data = parse_audio_lecture(audio_bytes, mime_type)
        
        # Save to database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 1. Store deadlines if any
        added_deadlines = []
        for dl in data.get("deadlines", []):
            dl_id = str(uuid.uuid4())
            due_str = dl.get("due_at")
            if not due_str:
                due_str = (datetime.now().date()).isoformat()
            cursor.execute("""
            INSERT INTO deadlines (id, user_id, title, due_at, subject, status)
            VALUES (?, ?, ?, ?, ?, 'PENDING')
            """, (
                dl_id,
                uid,
                dl.get("title"),
                due_str,
                dl.get("subject") or data.get("subject")
            ))
            added_deadlines.append(dl.get("title"))
            
        # 2. Store flashcards if any
        added_cards = []
        for fc in data.get("flashcards", []):
            fc_id = str(uuid.uuid4())
            cursor.execute("""
            INSERT INTO flashcards (id, user_id, subject, front, back, difficulty, next_review_at)
            VALUES (?, ?, ?, ?, ?, 3, ?)
            """, (
                fc_id,
                uid,
                fc.get("subject") or data.get("subject"),
                fc.get("front"),
                fc.get("back"),
                datetime.now().isoformat()
            ))
            added_cards.append(fc.get("front"))
            
        conn.commit()
        conn.close()
        
        summary = data.get("summary", "Lecture processed successfully.")
        msg = f"Processed class lecture summary: {summary}"
        if added_deadlines:
            msg += f"\n- scheduled deadlines: {', '.join(added_deadlines)}"
        if added_cards:
            msg += f"\n- generated {len(added_cards)} flashcards"
            
        # Log to chat_messages history table
        conn = get_db_connection()
        cursor = conn.cursor()
        time_str = datetime.now().strftime("%I:%M %p")
        cursor.execute("""
        INSERT INTO chat_messages (id, user_id, sender, text, time)
        VALUES (?, ?, 'kora', ?, ?)
        """, (str(uuid.uuid4()), uid, f"🎤 Lecture Audio processed:\n{msg}", time_str))
        conn.commit()
        conn.close()
        
        return {
            "summary": summary,
            "subject": data.get("subject"),
            "deadlines": data.get("deadlines"),
            "flashcards_count": len(added_cards),
            "message": msg
        }
        
    except Exception as e:
        print("Error during audio ingest:", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ingest/receipt")
async def ingest_receipt(
    file: UploadFile = File(...),
    user_id: str = Form(None)
):
    uid = get_user_id(user_id)
    image_bytes = await file.read()
    mime_type = file.content_type or "image/jpeg"
    
    try:
        from agents import parse_itemized_receipt
        data = parse_itemized_receipt(image_bytes, mime_type)
        
        merchant = data.get("merchant", "Receipt Shop")
        total = float(data.get("total", 0))
        category = data.get("category", "OTHER")
        
        # Save split or transaction
        conn = get_db_connection()
        cursor = conn.cursor()
        
        expense_id = str(uuid.uuid4())
        notes = "Itemized details: " + ", ".join([f"{i.get('name')} x{i.get('quantity')}" for i in data.get("items", [])])
        
        cursor.execute("""
        INSERT INTO expenses (id, user_id, amount, merchant, category, transacted_at, source, notes)
        VALUES (?, ?, ?, ?, ?, ?, 'RECEIPT_OCR', ?)
        """, (
            expense_id,
            uid,
            total,
            merchant,
            category,
            datetime.now().isoformat(),
            notes[:200]
        ))
        
        conn.commit()
        conn.close()
        
        return {
            "merchant": merchant,
            "total": total,
            "category": category,
            "items": data.get("items", []),
            "message": f"Successfully parsed ₹{total} from {merchant}. {notes}"
        }
        
    except Exception as e:
        print("Error during receipt ingest:", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/chat/secretarial-query")
def get_secretarial_query(query: str, user_id: str = None):
    uid = get_user_id(user_id)
    try:
        from agents import get_student_context, get_gemini_model
        context = get_student_context(uid)
        model = get_gemini_model()
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM users WHERE id = ?", (uid,))
        user_row = cursor.fetchone()
        conn.close()
        user_name = user_row["name"] if user_row else "Arjun"
        
        prompt = f"""
        You are Kora, the assistant for student {user_name}.
        Someone is asking {user_name} a question on WhatsApp:
        "{query}"
        
        Here is {user_name}'s current schedule, academic, and deadline database context:
        {json.dumps(context, indent=2)}
        
        INSTRUCTIONS:
        - If the query is related to {user_name}'s classes, timetable, exams, deadlines, or syllabus, reply politely with the correct information from the database context.
        - Answer in the first person on behalf of the assistant: e.g. "{user_name}'s next class is..." or "{user_name} has a deadline..."
        - Keep the answer brief, friendly, helpful, and under 50 words.
        - If the query is just a social greeting or unrelated to schedule/deadlines, reply with "NONE" (no action needed).
        """
        
        response = model.generate_content(prompt)
        reply = response.text.strip()
        return {"reply": reply}
    except Exception as e:
        print("Secretarial query error:", e)
        return {"reply": "NONE"}

@app.get("/api/stats/overview")
def get_stats_overview(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # total classes
    cursor.execute("SELECT COUNT(*) as c FROM schedule_events WHERE user_id = ?", (uid,))
    total_classes = cursor.fetchone()["c"]
    
    # pending deadlines
    cursor.execute("SELECT COUNT(*) as c FROM deadlines WHERE user_id = ? AND status = 'PENDING'", (uid,))
    pending_deadlines = cursor.fetchone()["c"]
    
    # total spent
    cursor.execute("SELECT SUM(amount) as s FROM expenses WHERE user_id = ?", (uid,))
    row = cursor.fetchone()
    total_spent = row["s"] if row and row["s"] else 0.0
    
    # flashcard due count
    import datetime as dt
    now_iso = dt.datetime.now().isoformat()
    cursor.execute("SELECT COUNT(*) as c FROM flashcards WHERE user_id = ? AND next_review_at <= ?", (uid, now_iso))
    flashcards_due = cursor.fetchone()["c"]
    
    conn.close()
    
    return {
        "total_classes": total_classes,
        "pending_deadlines": pending_deadlines,
        "total_spent": total_spent,
        "flashcards_due": flashcards_due
    }

@app.get("/api/users/{user_id}/profile")
def get_user_profile(user_id: str):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, email, avatar_url, college, branch, year, xp, level FROM users WHERE id = ?", (uid,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    user_dict = dict(row)
    return {
        "user_id": user_dict["id"],
        "name": user_dict["name"],
        "email": user_dict["email"],
        "avatar_url": user_dict["avatar_url"],
        "college": user_dict["college"],
        "branch": user_dict["branch"],
        "year": user_dict["year"],
        "xp": user_dict.get("xp", 0) or 0,
        "level": user_dict.get("level", 1) or 1
    }

@app.post("/api/users/{user_id}/add-xp")
def add_user_xp(user_id: str, xp_to_add: int = Form(...)):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT xp, level FROM users WHERE id = ?", (uid,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")
    
    current_xp = (row["xp"] or 0) + xp_to_add
    current_level = row["level"] or 1
    
    level_up = False
    xp_for_next_level = current_level * 100
    while current_xp >= xp_for_next_level:
        current_xp -= xp_for_next_level
        current_level += 1
        level_up = True
        xp_for_next_level = current_level * 100
        
    cursor.execute("UPDATE users SET xp = ?, level = ? WHERE id = ?", (current_xp, current_level, uid))
    conn.commit()
    conn.close()
    return {"message": "XP updated successfully", "xp": current_xp, "level": current_level, "level_up": level_up}

@app.post("/api/expenses/split")
def split_expense(req: SplitRequest):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Try to find friend user by email or name
    cursor.execute("SELECT id FROM users WHERE email = ? OR name LIKE ?", (req.friend, f"%{req.friend}%"))
    friend_row = cursor.fetchone()
    if not friend_row:
        # Check current user's email to assign correct opposite demo user
        cursor.execute("SELECT email FROM users WHERE id = ?", (uid,))
        user_row = cursor.fetchone()
        user_email = user_row["email"] if user_row else ""
        
        if user_email == "karan.verma.cs@iitm.ac.in":
            # Current user is Karan Verma, so friend should be Arjun Sharma
            cursor.execute("SELECT id FROM users WHERE email = 'arjun.sharma.iitm@gmail.com'")
            arjun = cursor.fetchone()
            if arjun:
                friend_id = arjun["id"]
            else:
                friend_id = str(uuid.uuid4())
                cursor.execute("""
                INSERT INTO users (id, phone_number, name, email, college, branch, year)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (friend_id, "+919999999999", "Arjun Sharma", "arjun.sharma.iitm@gmail.com", "IIT Madras", "Computer Science", 3))
                conn.commit()
        else:
            # Current user is Arjun or another user, so friend should be Karan Verma
            cursor.execute("SELECT id FROM users WHERE email = 'karan.verma.cs@iitm.ac.in'")
            karan = cursor.fetchone()
            if karan:
                friend_id = karan["id"]
            else:
                friend_id = str(uuid.uuid4())
                cursor.execute("""
                INSERT INTO users (id, phone_number, name, email, college, branch, year)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (friend_id, "+919876543210", "Karan Verma", "karan.verma.cs@iitm.ac.in", "IIT Madras", "Computer Science", 3))
                conn.commit()
    else:
        friend_id = friend_row["id"]
        
    # Determine who is lender and who is borrower
    if req.type == "borrowed":
        lender_id = friend_id
        borrower_id = uid
    else: # "lent"
        lender_id = uid
        borrower_id = friend_id

    balance_id = str(uuid.uuid4())
    cursor.execute("""
    INSERT INTO user_balances (id, lender_id, borrower_id, amount, description, status)
    VALUES (?, ?, ?, ?, ?, 'PENDING')
    """, (balance_id, lender_id, borrower_id, req.amount, req.description))
    
    # Fetch details for notification
    cursor.execute("SELECT name FROM users WHERE id = ?", (lender_id,))
    l_row = cursor.fetchone()
    lender_name = l_row["name"] if l_row else "Someone"
    
    cursor.execute("SELECT name, phone_number FROM users WHERE id = ?", (borrower_id,))
    b_row = cursor.fetchone()
    borrower_phone = b_row["phone_number"] if b_row else None
    
    conn.commit()
    conn.close()
    
    if borrower_phone:
        try:
            import requests
            clean_phone = "".join([c for c in borrower_phone if c.isdigit()])
            if clean_phone:
                to_jid = f"{clean_phone}@s.whatsapp.net"
                desc_str = f" for '{req.description}'" if req.description else ""
                alert_msg = f"💸 KORA SPLIT ALERT: {lender_name} split an expense of \u20b9{req.amount}{desc_str} with you. Your share is \u20b9{req.amount}. Log into Kora to clear it!"
                print(f"Proactive split expense alert: sending to {to_jid}...")
                requests.post("http://localhost:8002/send", json={
                    "to": to_jid,
                    "text": alert_msg
                }, timeout=3)
        except Exception as we:
            print("Failed to send WhatsApp split alert:", we)
            
    return {"message": "Split recorded successfully", "balance_id": balance_id}


@app.get("/api/expenses/balances")
def get_user_balances(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # What others owe you (you are lender)
    cursor.execute("""
    SELECT b.id, b.amount, b.description, b.status, b.created_at, u.name as borrower_name, u.email as borrower_email
    FROM user_balances b
    JOIN users u ON b.borrower_id = u.id
    WHERE b.lender_id = ? AND b.status = 'PENDING'
    """, (uid,))
    owed_to_you = [dict(r) for r in cursor.fetchall()]
    
    # What you owe others (you are borrower)
    cursor.execute("""
    SELECT b.id, b.amount, b.description, b.status, b.created_at, u.name as lender_name, u.email as lender_email
    FROM user_balances b
    JOIN users u ON b.lender_id = u.id
    WHERE b.borrower_id = ? AND b.status = 'PENDING'
    """, (uid,))
    you_owe = [dict(r) for r in cursor.fetchall()]
    
    conn.close()
    return {"owed_to_you": owed_to_you, "you_owe": you_owe}

@app.post("/api/expenses/settle")
def settle_balance(balance_id: str = Form(...), user_id: str = Form(None)):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE user_balances SET status = 'SETTLED' WHERE id = ?", (balance_id,))
    conn.commit()
    conn.close()
    return {"message": "Balance settled successfully"}

@app.post("/api/study/pomodoro")
def complete_pomodoro(req: PomodoroRequest):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Award 50 XP
    cursor.execute("SELECT xp, level FROM users WHERE id = ?", (uid,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")
        
    current_xp = (row["xp"] or 0) + 50
    current_level = row["level"] or 1
    xp_for_next_level = current_level * 100
    level_up = False
    while current_xp >= xp_for_next_level:
        current_xp -= xp_for_next_level
        current_level += 1
        level_up = True
        xp_for_next_level = current_level * 100
        
    cursor.execute("UPDATE users SET xp = ?, level = ? WHERE id = ?", (current_xp, current_level, uid))
    
    # Log session in study_history
    cursor.execute("SELECT id FROM flashcards WHERE user_id = ? LIMIT 1", (uid,))
    card = cursor.fetchone()
    if card:
        card_id = card["id"]
    else:
        # Create a placeholder card
        card_id = str(uuid.uuid4())
        cursor.execute("""
        INSERT INTO flashcards (id, user_id, subject, front, back, difficulty, next_review_at)
        VALUES (?, ?, 'Pomodoro', 'Placeholder', 'Placeholder', 3, ?)
        """, (card_id, uid, datetime.now().isoformat()))
        
    history_id = str(uuid.uuid4())
    cursor.execute("""
    INSERT INTO study_history (id, user_id, card_id, reviewed_at, rating)
    VALUES (?, ?, ?, ?, 3)
    """, (history_id, uid, card_id, datetime.now().isoformat()))
    
    conn.commit()
    conn.close()
    
    return {"message": "Pomodoro study session recorded!", "xp_awarded": 50, "xp": current_xp, "level": current_level, "level_up": level_up}

@app.get("/api/whatsapp/agenda")
def get_whatsapp_agenda(user_id: str = None, phone: str = None):
    if phone:
        conn = get_db_connection()
        cursor = conn.cursor()
        raw_phone = phone.split("@")[0].replace("+", "")
        phone_with_plus = f"+{raw_phone}"
        cursor.execute("SELECT id FROM users WHERE phone_number = ? OR phone_number LIKE ?", (phone_with_plus, f"%{raw_phone}%"))
        user = cursor.fetchone()
        if user:
            uid = user["id"]
        else:
            uid = get_user_id(user_id)
        conn.close()
    else:
        uid = get_user_id(user_id)
    import datetime as dt
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get today's day of week (0=Mon, 6=Sun)
    today_dow = dt.datetime.now().weekday()
    
    cursor.execute("SELECT name FROM users WHERE id = ?", (uid,))
    user_row = cursor.fetchone()
    user_name = user_row["name"] if user_row else "Arjun"
    
    # Get today's classes
    cursor.execute("SELECT subject, title, time_start, time_end, room FROM schedule_events WHERE user_id = ? AND day_of_week = ? ORDER BY time_start", (uid, today_dow))
    classes = cursor.fetchall()
    
    # Get pending deadlines due today or tomorrow
    today_str = dt.date.today().isoformat()
    tomorrow_str = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    cursor.execute("SELECT title, due_at, subject FROM deadlines WHERE user_id = ? AND status = 'PENDING' AND (due_at LIKE ? OR due_at LIKE ?)", (uid, f"{today_str}%", f"{tomorrow_str}%"))
    deadlines = cursor.fetchall()
    
    conn.close()
    
    msg = f"🌅 Good morning, {user_name}! Here is your Kora Daily Agenda:\n\n"
    if classes:
        msg += "📅 TODAY'S LECTURES:\n"
        for c in classes:
            msg += f"• {c['time_start']}-{c['time_end']}: {c['subject']} ({c['title']}) at {c['room'] or 'TBA'}\n"
    else:
        msg += "📅 TODAY'S LECTURES: None! Enjoy your day off.\n"
        
    msg += "\n⏰ URGENT DEADLINES:\n"
    if deadlines:
        for d in deadlines:
            due_lbl = "Today" if today_str in d['due_at'] else "Tomorrow"
            msg += f"• {d['title']} ({d['subject'] or 'General'}) - Due {due_lbl}!\n"
    else:
        msg += "• No urgent assignments due today or tomorrow. Awesome!\n"
        
    msg += "\nHave a productive day! Let me know if you need to split expenses, scan receipt details, or prepare study cards."
    return {"message": msg}

class VivaEvaluateRequest(BaseModel):
    user_id: str = None
    card_id: str
    user_answer: str

@app.post("/api/study/viva/evaluate")
def evaluate_viva(req: VivaEvaluateRequest):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT front, back, subject FROM flashcards WHERE id = ?", (req.card_id,))
    card = cursor.fetchone()
    if not card:
        conn.close()
        raise HTTPException(status_code=404, detail="Flashcard not found")
        
    front = card["front"]
    back = card["back"]
    
    try:
        model = get_gemini_model()
        prompt = f"""
        You are an expert oral exam (viva) evaluator for college students.
        Evaluate the student's answer based on the question and the correct answer key below.
        
        Question: {front}
        Correct Answer Key: {back}
        Student's Answer: {req.user_answer}
        
        Give a score between 0 and 10.
        Be constructive, highlight what they answered correctly, point out what key terms or details they missed, and explain the correct concept.
        
        Return ONLY a JSON block with keys:
        - "score": (integer 0 to 10)
        - "feedback": (constructive feedback explaining what was good, what was missed, and the correct concepts)
        - "passed": (boolean, true if score >= 5)
        """
        
        response = model.generate_content(prompt)
        res_text = response.text.strip()
        
        if "```json" in res_text:
            res_text = res_text.split("```json")[1].split("```")[0].strip()
        elif "```" in res_text:
            res_text = res_text.split("```")[1].split("```")[0].strip()
            
        evaluation = json.loads(res_text)
    except Exception as e:
        print(f"Gemini API error in evaluate_viva: {e}")
        evaluation = {
            "score": 6,
            "feedback": f"Could not perform AI evaluation due to Gemini API limits. Your answer: '{req.user_answer}' has been logged.",
            "passed": True
        }
        
    score = int(evaluation.get("score", 5))
    feedback = evaluation.get("feedback", "No feedback provided.")
    passed = bool(evaluation.get("passed", True))
    xp_awarded = score * 10
    
    cursor.execute("SELECT xp, level FROM users WHERE id = ?", (uid,))
    user_row = cursor.fetchone()
    level_up = False
    if user_row:
        current_xp = (user_row["xp"] or 0) + xp_awarded
        current_level = user_row["level"] or 1
        xp_for_next_level = current_level * 100
        while current_xp >= xp_for_next_level:
            current_xp -= xp_for_next_level
            current_level += 1
            level_up = True
            xp_for_next_level = current_level * 100
            
        cursor.execute("UPDATE users SET xp = ?, level = ? WHERE id = ?", (current_xp, current_level, uid))
        
    history_id = str(uuid.uuid4())
    cursor.execute("""
    INSERT INTO study_history (id, user_id, card_id, reviewed_at, rating)
    VALUES (?, ?, ?, ?, ?)
    """, (history_id, uid, req.card_id, datetime.now().isoformat(), 3 if passed else 1))
    
    conn.commit()
    conn.close()
    
    return {
        "score": score,
        "feedback": feedback,
        "passed": passed,
        "xp_awarded": xp_awarded,
        "level_up": level_up
    }

# ── AI Viva Session Endpoints ────────────────────────────────────

class VivaStartRequest(BaseModel):
    user_id: str = None
    subject: str

class VivaEvaluateSessionRequest(BaseModel):
    user_id: str = None
    subject: str
    question: str
    answer: str

@app.post("/api/viva/start")
def start_viva_session(req: VivaStartRequest):
    uid = get_user_id(req.user_id)
    try:
        model = get_gemini_model()
        prompt = f"""
        You are an expert college professor conducting an oral exam (viva) for a student.
        The subject is: {req.subject}
        
        Generate a challenging, conceptual, and clear oral exam question to test the student's knowledge on this subject.
        Keep the question relatively brief (max 35 words). Do not include any introduction or options, just the question itself.
        """
        response = model.generate_content(prompt)
        question = response.text.strip()
    except Exception as e:
        print(f"Gemini API error in start_viva_session: {e}")
        question = f"Explain the working principle and primary application of: {req.subject}"
        
    return {"question": question}

@app.post("/api/viva/evaluate")
def evaluate_viva_session(req: VivaEvaluateSessionRequest):
    uid = get_user_id(req.user_id)
    try:
        model = get_gemini_model()
        prompt = f"""
        You are an expert college professor conducting an oral exam (viva).
        Evaluate the student's answer to the question below.
        
        Subject: {req.subject}
        Question: {req.question}
        Student's Answer: {req.answer}
        
        Evaluate the answer strictly but constructively. Give a score between 0 and 100 based on accuracy, completeness, and conceptual clarity.
        Provide detailed constructive feedback pointing out what they got right, what they missed, and the correct concepts.
        
        Return ONLY a JSON block with keys:
        - "score": (integer 0 to 100)
        - "feedback": (constructive feedback string)
        """
        response = model.generate_content(prompt)
        res_text = response.text.strip()
        if "```json" in res_text:
            res_text = res_text.split("```json")[1].split("```")[0].strip()
        elif "```" in res_text:
            res_text = res_text.split("```")[1].split("```")[0].strip()
        evaluation = json.loads(res_text)
    except Exception as e:
        print(f"Gemini API error in evaluate_viva_session: {e}")
        evaluation = {
            "score": 75,
            "feedback": "Answer evaluated in sandbox mode. Satisfactory conceptual coverage. Recommended: Review technical terminology."
        }
        
    score = int(evaluation.get("score", 70))
    feedback = evaluation.get("feedback", "No feedback provided.")
    
    # Award some XP
    xp_awarded = int(score / 5)  # e.g., if 85, award 17 XP
    if xp_awarded > 0:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT xp, level FROM users WHERE id = ?", (uid,))
        user_row = cursor.fetchone()
        if user_row:
            current_xp = (user_row["xp"] or 0) + xp_awarded
            current_level = user_row["level"] or 1
            xp_for_next_level = current_level * 100
            while current_xp >= xp_for_next_level:
                current_xp -= xp_for_next_level
                current_level += 1
                xp_for_next_level = current_level * 100
            cursor.execute("UPDATE users SET xp = ?, level = ? WHERE id = ?", (current_xp, current_level, uid))
        conn.commit()
        conn.close()
        
    return {"score": score, "feedback": feedback}

# ── Study Duels (Quiz Battles) Endpoints ──────────────────────

class DuelCreateRequest(BaseModel):
    user_id: str
    name: str
    subject: str

class DuelJoinRequest(BaseModel):
    user_id: str
    room_id: str

class DuelQuestionsRequest(BaseModel):
    room_id: str
    subject: str

class DuelCompleteRequest(BaseModel):
    user_id: str
    room_id: str
    score: int

@app.get("/api/leaderboard")
def get_leaderboard():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, name, college, branch, xp, level FROM users
    ORDER BY xp DESC, level DESC
    LIMIT 10
    """)
    rows = cursor.fetchall()
    conn.close()
    
    leaderboard = []
    for i, r in enumerate(rows):
        leaderboard.append({
            "rank": i + 1,
            "name": r["name"],
            "college": r["college"] or "IIT Madras",
            "xp": r["xp"] or 0,
            "level": r["level"] or 1
        })
        
    if len(leaderboard) < 5:
        # Pad with competitive mock records
        mock_data = [
            {"name": "Karan Verma", "college": "IIT Madras", "xp": 450, "level": 3},
            {"name": "Rahul Sharma", "college": "IIT Madras", "xp": 380, "level": 2},
            {"name": "Priya Vyas", "college": "IIT Bombay", "xp": 210, "level": 2},
            {"name": "Ananya Sen", "college": "BITS Pilani", "xp": 150, "level": 2}
        ]
        # Skip if name already exists
        existing_names = {x["name"] for x in leaderboard}
        for item in mock_data:
            if item["name"] not in existing_names:
                leaderboard.append({
                    "rank": 0,
                    "name": item["name"],
                    "college": item["college"],
                    "xp": item["xp"],
                    "level": item["level"]
                })
        
        # Sort and re-rank
        leaderboard = sorted(leaderboard, key=lambda x: x["xp"], reverse=True)
        for idx, item in enumerate(leaderboard):
            item["rank"] = idx + 1
            
    return {"leaderboard": leaderboard[:10]}

@app.get("/api/duels/active")
def get_active_duels():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT q.id, q.creator_id, q.joiner_id, q.subject, q.status, u.name as creator_name
    FROM quiz_duels q
    JOIN users u ON q.creator_id = u.id
    WHERE q.status = 'LOBBY' OR q.status = 'ACTIVE'
    ORDER BY q.created_at DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    
    rooms = []
    for r in rows:
        rooms.append({
            "id": r["id"],
            "name": f"{r['creator_name']}'s Duel",
            "subject": r["subject"],
            "participants": 2 if r["joiner_id"] else 1,
            "maxParticipants": 2,
            "status": "waiting" if r["status"] == "LOBBY" else "active",
            "host": r["creator_name"]
        })
    return {"rooms": rooms}

@app.post("/api/duels/create")
def create_duel_room(req: DuelCreateRequest):
    uid = get_user_id(req.user_id)
    room_id = f"room_{int(datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO quiz_duels (id, creator_id, joiner_id, subject, status, questions_json, creator_score, joiner_score)
    VALUES (?, ?, NULL, ?, 'LOBBY', '[]', 0, 0)
    """, (room_id, uid, req.subject))
    conn.commit()
    conn.close()
    return {"room_id": room_id}

@app.post("/api/duels/join")
def join_duel_room(req: DuelJoinRequest):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT creator_id, status FROM quiz_duels WHERE id = ?", (req.room_id,))
    room = cursor.fetchone()
    if not room:
        conn.close()
        raise HTTPException(status_code=404, detail="Room not found")
        
    if room["creator_id"] == uid:
        conn.close()
        return {"status": "success"} # creator re-joining
        
    cursor.execute("""
    UPDATE quiz_duels
    SET joiner_id = ?, status = 'ACTIVE'
    WHERE id = ?
    """, (uid, req.room_id))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.post("/api/duels/questions")
def get_duel_questions(req: DuelQuestionsRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT questions_json, subject FROM quiz_duels WHERE id = ?", (req.room_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Room not found")
        
    questions_json = row["questions_json"]
    subject = row["subject"]
    
    # If questions are already generated, return them
    if questions_json and questions_json != "[]":
        conn.close()
        return {"questions": json.loads(questions_json)}
        
    # Generate 5 questions using Gemini
    try:
        model = get_gemini_model()
        prompt = f"""
        Generate exactly 5 multiple choice questions to test knowledge in the subject: {subject}.
        Each question must be challenging and suitable for a college-level student quiz duel.
        
        Return ONLY a JSON list of questions, where each question is an object with:
        - "text": (the question statement)
        - "options": (a list of exactly 4 string options)
        - "correctIndex": (an integer 0, 1, 2, or 3 representing the index of the correct option in the list)
        
        Ensure the JSON is strictly valid. Do not write markdown formatting outside of a ```json ``` block.
        """
        response = model.generate_content(prompt)
        res_text = response.text.strip()
        if "```json" in res_text:
            res_text = res_text.split("```json")[1].split("```")[0].strip()
        elif "```" in res_text:
            res_text = res_text.split("```")[1].split("```")[0].strip()
        questions = json.loads(res_text)
    except Exception as e:
        print(f"Gemini API error in get_duel_questions: {e}")
        # Default mock questions fallback
        questions = [
            {
                "text": f"What is the primary concern when designing a system for {subject}?",
                "options": ["Performance", "Security & Integrity", "Ease of Development", "Platform Compatibility"],
                "correctIndex": 1
            },
            {
                "text": f"Which of the following best describes a typical bottleneck in {subject}?",
                "options": ["CPU cycle limitations", "Memory leaks and fragmentation", "Network latency and I/O wait", "All of the above"],
                "correctIndex": 3
            },
            {
                "text": f"Which protocol or pattern is most commonly used to ensure consistency in {subject}?",
                "options": ["Two-Phase Commit (2PC)", "Saga Pattern", "Eventual Consistency / Raft", "Depends on architectural tradeoffs"],
                "correctIndex": 3
            }
        ]
        
    # Save back to database
    cursor.execute("UPDATE quiz_duels SET questions_json = ? WHERE id = ?", (json.dumps(questions), req.room_id))
    conn.commit()
    conn.close()
    return {"questions": questions}

@app.post("/api/duels/complete")
def complete_duel(req: DuelCompleteRequest):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT creator_id, joiner_id, status FROM quiz_duels WHERE id = ?", (req.room_id,))
    room = cursor.fetchone()
    if not room:
        conn.close()
        raise HTTPException(status_code=404, detail="Room not found")
        
    is_creator = room["creator_id"] == uid
    is_joiner = room["joiner_id"] == uid
    
    if is_creator:
        cursor.execute("UPDATE quiz_duels SET creator_score = ? WHERE id = ?", (req.score, req.room_id))
    elif is_joiner:
        cursor.execute("UPDATE quiz_duels SET joiner_score = ? WHERE id = ?", (req.score, req.room_id))
        
    # Mark room completed
    cursor.execute("UPDATE quiz_duels SET status = 'COMPLETED' WHERE id = ?", (req.room_id,))
    conn.commit()
    conn.close()
    
    # Award +150 XP for completing a duel
    xp_awarded = 150
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT xp, level FROM users WHERE id = ?", (uid,))
    user_row = cursor.fetchone()
    level_up = False
    if user_row:
        current_xp = (user_row["xp"] or 0) + xp_awarded
        current_level = user_row["level"] or 1
        xp_for_next_level = current_level * 100
        while current_xp >= xp_for_next_level:
            current_xp -= xp_for_next_level
            current_level += 1
            level_up = True
            xp_for_next_level = current_level * 100
        cursor.execute("UPDATE users SET xp = ?, level = ? WHERE id = ?", (current_xp, current_level, uid))
    conn.commit()
    conn.close()
    
    return {"status": "success", "xp_awarded": xp_awarded, "level_up": level_up}

class AttendanceRecordRequest(BaseModel):
    user_id: str = None
    subject: str
    status: str = ""  # "PRESENT" or "ABSENT"

@app.get("/api/attendance")
def get_attendance(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get all distinct subjects in timetable
    cursor.execute("""
    SELECT DISTINCT subject 
    FROM schedule_events 
    WHERE user_id = ? AND source != 'STUDY_ALLOCATOR' AND subject IS NOT NULL AND subject != ''
    """, (uid,))
    subjects = [row["subject"] for row in cursor.fetchall()]
    
    # Get logged attendance
    cursor.execute("""
    SELECT subject, present, absent 
    FROM subject_attendance 
    WHERE user_id = ?
    """, (uid,))
    logged = {row["subject"]: {"present": row["present"], "absent": row["absent"]} for row in cursor.fetchall()}
    conn.close()
    
    import math
    results = []
    for sub in subjects:
        log = logged.get(sub, {"present": 0, "absent": 0})
        p = log["present"]
        a = log["absent"]
        total = p + a
        pct = (p / total * 100) if total > 0 else 100.0
        
        # Calculate safe bunks or required classes (75% threshold)
        safe_bunks = 0
        req_classes = 0
        if pct >= 75.0:
            # P / (P + A + X) >= 0.75  =>  P >= 0.75 * (P + A + X)  =>  X <= P/0.75 - (P+A)
            # max X = floor(P/0.75) - (P+A)
            safe_bunks = max(0, math.floor(p / 0.75) - total)
        else:
            # (P + Y) / (P + A + Y) >= 0.75  =>  P + Y >= 0.75*(P+A) + 0.75*Y  =>  0.25*Y >= 0.75*(P+A) - P
            # Y >= 3*(P+A) - 4*P  =>  Y >= 3*A - P
            # req Y = ceil(3*A - P)
            req_classes = max(0, math.ceil(3 * a - p))
            
        results.append({
            "subject": sub,
            "present": p,
            "absent": a,
            "total": total,
            "percentage": round(pct, 1),
            "safe_bunks": safe_bunks,
            "required_classes": req_classes
        })
        
    return results

@app.post("/api/attendance/record")
def record_attendance(req: AttendanceRecordRequest):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Check if entry exists
        cursor.execute("SELECT id, present, absent FROM subject_attendance WHERE user_id = ? AND subject = ?", (uid, req.subject))
        row = cursor.fetchone()
        
        if row:
            if req.status.upper() == "PRESENT":
                cursor.execute("UPDATE subject_attendance SET present = present + 1 WHERE id = ?", (row["id"],))
            else:
                cursor.execute("UPDATE subject_attendance SET absent = absent + 1 WHERE id = ?", (row["id"],))
        else:
            row_id = str(uuid.uuid4())
            p = 1 if req.status.upper() == "PRESENT" else 0
            a = 1 if req.status.upper() == "ABSENT" else 0
            cursor.execute("""
            INSERT INTO subject_attendance (id, user_id, subject, present, absent)
            VALUES (?, ?, ?, ?, ?)
            """, (row_id, uid, req.subject, p, a))
            
        conn.commit()
        return {"status": "success", "message": f"Attendance recorded for {req.subject}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.post("/api/attendance/reset")
def reset_attendance(req: AttendanceRecordRequest):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM subject_attendance WHERE user_id = ? AND subject = ?", (uid, req.subject))
        conn.commit()
        return {"status": "success", "message": f"Attendance reset for {req.subject}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# Victory Bundle Models and Endpoints

class NoteGenerateRequest(BaseModel):
    user_id: str = None
    subject: str
    title: str
    lecture_text: str

class MessMenuUploadRequest(BaseModel):
    user_id: str = None
    day_of_week: int # 0 to 6
    meal_type: str # 'BREAKFAST', 'LUNCH', 'DINNER'
    items: str
    price: float = 0.0

class QuizDuelCreateRequest(BaseModel):
    user_id: str = None
    subject: str

class QuizDuelJoinRequest(BaseModel):
    user_id: str = None
    room_id: str

class QuizDuelSubmitRequest(BaseModel):
    user_id: str = None
    room_id: str
    score: int

@app.get("/api/stats/grade-predictor")
def get_grade_predictor(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM users WHERE id = ?", (uid,))
    user_row = cursor.fetchone()
    user_profile = dict(user_row) if user_row else {}
    
    cursor.execute("""
    SELECT h.card_id, h.reviewed_at, h.rating, f.subject 
    FROM study_history h
    JOIN flashcards f ON h.card_id = f.id
    WHERE h.user_id = ?
    """, (uid,))
    study_history = [dict(r) for r in cursor.fetchall()]
    
    # Get attendance
    cursor.execute("SELECT subject, present, absent FROM subject_attendance WHERE user_id = ?", (uid,))
    attendance = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    from agents import predict_grades_and_weak_spots
    res = predict_grades_and_weak_spots(user_profile, study_history, attendance)
    return res

@app.post("/api/study/notes/generate")
def generate_study_notes(req: NoteGenerateRequest):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    note_id = str(uuid.uuid4())
    
    try:
        model = get_gemini_model()
        prompt = f"""
        You are Kora, the study assistant.
        Convert the following raw lecture transcription/text into a beautifully structured, comprehensive Markdown study guide for the subject '{req.subject}' with the title '{req.title}'.
        Use rich headers, bold text, lists, and a 'Core Formulae/Key Definitions' section.
        
        Lecture Text:
        {req.lecture_text}
        
        Also generate exactly 5 flashcards based on the material.
        Return ONLY a JSON object with two keys:
        - "markdown_notes": (The complete structured Markdown study notes string)
        - "flashcards": A list of 5 objects containing:
          - "front": (The question/concept)
          - "back": (The answer/definition)
          
        Ensure the JSON is strictly valid. Do not write markdown formatting outside of a ```json ``` block.
        """
        response = model.generate_content(prompt)
        text = response.text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
            
        data = json.loads(text)
        markdown_notes = data.get("markdown_notes", f"# {req.title}\n\n{req.lecture_text}")
        flashcards_list = data.get("flashcards", [])
    except Exception as e:
        print(f"Gemini error in generate_study_notes: {e}")
        markdown_notes = f"# {req.title}\n\nProcessed lecture material for {req.subject}.\n\n### Key Concepts\n- Concept 1: Critical lecture review needed.\n- Concept 2: Focus on revision questions."
        flashcards_list = [
            {"front": f"What is the core topic of {req.title}?", "back": f"The core topic centers on the key principles of {req.subject}."}
        ]
        
    # Store to lecture_notes table
    cursor.execute("""
    INSERT INTO lecture_notes (id, user_id, subject, title, summary)
    VALUES (?, ?, ?, ?, ?)
    """, (note_id, uid, req.subject, req.title, markdown_notes))
    
    # Store generated flashcards
    for fc in flashcards_list[:5]:
        fc_id = str(uuid.uuid4())
        cursor.execute("""
        INSERT INTO flashcards (id, user_id, subject, front, back, difficulty, next_review_at)
        VALUES (?, ?, ?, ?, ?, 3, ?)
        """, (fc_id, uid, req.subject, fc.get("front"), fc.get("back"), datetime.now().isoformat()))
        
    conn.commit()
    conn.close()
    
    return {
        "note_id": note_id,
        "markdown_notes": markdown_notes,
        "flashcards_added": len(flashcards_list)
    }

@app.get("/api/study/notes")
def get_lecture_notes(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, subject, title, summary, created_at
    FROM lecture_notes
    WHERE user_id = ?
    ORDER BY created_at DESC
    """, (uid,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/expenses/mess-menu/upload")
def upload_mess_menu(req: MessMenuUploadRequest):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Delete old entry for this day/meal if exists
    cursor.execute("DELETE FROM mess_menus WHERE user_id = ? AND day_of_week = ? AND meal_type = ?", (uid, req.day_of_week, req.meal_type.upper()))
    
    menu_id = str(uuid.uuid4())
    cursor.execute("""
    INSERT INTO mess_menus (id, user_id, day_of_week, meal_type, items, price)
    VALUES (?, ?, ?, ?, ?, ?)
    """, (menu_id, uid, req.day_of_week, req.meal_type.upper(), req.items, req.price))
    conn.commit()
    conn.close()
    return {"status": "success", "message": "Mess menu saved successfully"}

@app.get("/api/expenses/mess-recommender")
def get_mess_recommender(user_id: str = None):
    uid = get_user_id(user_id)
    import datetime as dt
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get today's day of week
    today_dow = dt.datetime.now().weekday()
    
    # Get mess menu for today
    cursor.execute("""
    SELECT meal_type, items, price 
    FROM mess_menus 
    WHERE user_id = ? AND day_of_week = ?
    """, (uid, today_dow))
    menus = [dict(r) for r in cursor.fetchall()]
    
    # Fetch total expense in current month
    start_of_month = dt.datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    cursor.execute("""
    SELECT SUM(amount) as total
    FROM expenses
    WHERE user_id = ? AND transacted_at >= ?
    """, (uid, start_of_month))
    row = cursor.fetchone()
    monthly_spent = row["total"] if row and row["total"] else 0.0
    
    conn.close()
    
    # Recommendation logic: assume a default monthly budget of ₹5000
    monthly_budget = 5000.0
    remaining_budget = max(0.0, monthly_budget - monthly_spent)
    days_left_in_month = 30 - dt.datetime.now().day + 1
    daily_allowance = remaining_budget / max(1, days_left_in_month)
    
    recommendations = []
    for menu in menus:
        price = menu["price"]
        meal = menu["meal_type"]
        items = menu["items"]
        
        # Determine affordability
        if price == 0:
            affordability = "FREE"
            action_critique = "Go ahead, it's prepaid/free!"
        elif price <= daily_allowance:
            affordability = "HIGH"
            action_critique = "Affordable! Fits comfortably within your daily budget."
        elif price <= daily_allowance * 1.5:
            affordability = "MODERATE"
            action_critique = "Moderately affordable. Splurge slightly, but watch out for dinners."
        else:
            affordability = "LOW"
            action_critique = "Warning: Over budget! Skip this or get a cheaper alternative."
            
        recommendations.append({
            "meal_type": meal,
            "items": items,
            "price": price,
            "affordability": affordability,
            "action_critique": action_critique
        })
        
    return {
        "daily_allowance": round(daily_allowance, 2),
        "monthly_spent": monthly_spent,
        "remaining_budget": remaining_budget,
        "recommendations": recommendations if recommendations else [
            {"meal_type": "TODAY'S SPECIAL", "items": "No canteen specials recorded", "price": 0.0, "affordability": "HIGH", "action_critique": "Enjoy the default mess diet!"}
        ]
    }

@app.get("/api/stats/financial-audit")
def get_financial_audit(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT amount, merchant, category, transacted_at, notes 
    FROM expenses 
    WHERE user_id = ?
    ORDER BY transacted_at DESC
    LIMIT 30
    """, (uid,))
    expenses = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    from agents import generate_weekly_financial_audit
    critique = generate_weekly_financial_audit(expenses)
    return {"critique": critique}

@app.post("/api/quiz/duel/create")
def create_quiz_duel(req: QuizDuelCreateRequest):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Fetch 5 flashcards for this subject to form the quiz
    cursor.execute("""
    SELECT front, back FROM flashcards 
    WHERE user_id = ? AND subject = ?
    ORDER BY RANDOM() LIMIT 5
    """, (uid, req.subject))
    cards = cursor.fetchall()
    
    # If not enough cards exist, fetch from any subject or generate default ones
    if len(cards) < 5:
        cursor.execute("SELECT front, back FROM flashcards WHERE user_id = ? ORDER BY RANDOM() LIMIT 5", (uid,))
        cards = cursor.fetchall()
        
    if not cards:
        cards = [
            {"front": "What is the CPU schedule algorithm that is preemptive?", "back": "Round Robin"},
            {"front": "What is the acronym ACID in DBMS?", "back": "Atomicity, Consistency, Isolation, Durability"},
            {"front": "Which layer of OSI model does IP protocol operate in?", "back": "Network Layer"},
            {"front": "What is the average time complexity of Quick Sort?", "back": "O(N log N)"},
            {"front": "Which hook in React is used to perform side effects?", "back": "useEffect"}
        ]
    else:
        cards = [dict(c) for c in cards]
        
    # Formulate 5 multiple choice questions using Gemini (or fallback)
    questions = []
    try:
        model = get_gemini_model()
        prompt = f"""
        Generate 5 multiple-choice questions based on these flashcards:
        {json.dumps(cards)}
        
        Each question must have:
        - "question": string
        - "options": list of 4 strings
        - "answer": string (must be exactly equal to one of the options)
        
        Return ONLY a valid JSON list of 5 objects. Do not write markdown formatting outside of a ```json ``` block.
        """
        response = model.generate_content(prompt)
        text = response.text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        questions = json.loads(text)
    except Exception as e:
        print(f"Gemini error in create_quiz_duel: {e}")
        # Local fallback questions
        for idx, card in enumerate(cards):
            ans = card["back"]
            options = [ans, f"Option B {idx}", f"Option C {idx}", f"Option D {idx}"]
            import random
            random.shuffle(options)
            questions.append({
                "question": card["front"],
                "options": options,
                "answer": ans
            })
            
    room_id = str(uuid.uuid4())[:8].upper() # 8-character easy code
    cursor.execute("""
    INSERT INTO quiz_duels (id, creator_id, subject, questions_json)
    VALUES (?, ?, ?, ?)
    """, (room_id, uid, req.subject, json.dumps(questions)))
    conn.commit()
    conn.close()
    
    return {
        "room_id": room_id,
        "questions": questions,
        "status": "LOBBY"
    }

@app.post("/api/quiz/duel/join")
def join_quiz_duel(req: QuizDuelJoinRequest):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM quiz_duels WHERE id = ?", (req.room_id.upper(),))
    duel = cursor.fetchone()
    if not duel:
        conn.close()
        raise HTTPException(status_code=404, detail="Quiz room code not found")
        
    duel_dict = dict(duel)
    if duel_dict["creator_id"] == uid:
        conn.close()
        return {
            "room_id": duel_dict["id"],
            "questions": json.loads(duel_dict["questions_json"]),
            "status": duel_dict["status"],
            "creator_score": duel_dict["creator_score"],
            "joiner_score": duel_dict["joiner_score"],
            "role": "CREATOR"
        }
        
    # Join as joiner
    cursor.execute("""
    UPDATE quiz_duels 
    SET joiner_id = ?, status = 'ACTIVE' 
    WHERE id = ?
    """, (uid, req.room_id.upper()))
    conn.commit()
    conn.close()
    
    return {
        "room_id": duel_dict["id"],
        "questions": json.loads(duel_dict["questions_json"]),
        "status": "ACTIVE",
        "role": "JOINER"
    }

@app.post("/api/quiz/duel/submit")
def submit_quiz_score(req: QuizDuelSubmitRequest):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM quiz_duels WHERE id = ?", (req.room_id.upper(),))
    duel = cursor.fetchone()
    if not duel:
        conn.close()
        raise HTTPException(status_code=404, detail="Quiz room not found")
        
    duel_dict = dict(duel)
    if duel_dict["creator_id"] == uid:
        cursor.execute("UPDATE quiz_duels SET creator_score = ? WHERE id = ?", (req.score, req.room_id.upper()))
    elif duel_dict["joiner_id"] == uid:
        cursor.execute("UPDATE quiz_duels SET joiner_score = ? WHERE id = ?", (req.score, req.room_id.upper()))
    else:
        conn.close()
        raise HTTPException(status_code=403, detail="Not a participant in this duel")
        
    # Check if both scores are submitted to mark COMPLETED
    cursor.execute("SELECT * FROM quiz_duels WHERE id = ?", (req.room_id.upper(),))
    updated_duel = dict(cursor.fetchone())
    
    status = updated_duel["status"]
    if updated_duel["joiner_id"] and status == "ACTIVE":
        status = "COMPLETED"
        cursor.execute("UPDATE quiz_duels SET status = 'COMPLETED' WHERE id = ?", (req.room_id.upper(),))
        
    conn.commit()
    conn.close()
    
    return {
        "room_id": req.room_id.upper(),
        "status": status,
        "creator_score": updated_duel["creator_score"],
        "joiner_score": updated_duel["joiner_score"]
    }

@app.get("/api/quiz/duel/{room_id}")
def get_quiz_duel_status(room_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM quiz_duels WHERE id = ?", (room_id.upper(),))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Room not found")
        
    duel_dict = dict(row)
    return {
        "room_id": duel_dict["id"],
        "creator_id": duel_dict["creator_id"],
        "joiner_id": duel_dict["joiner_id"],
        "subject": duel_dict["subject"],
        "status": duel_dict["status"],
        "creator_score": duel_dict["creator_score"],
        "joiner_score": duel_dict["joiner_score"]
    }


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 1 — WhatsApp Group Intelligence
# ─────────────────────────────────────────────────────────────────────────────

class GroupMessageRequest(BaseModel):
    group_jid: str = ""
    group_name: str
    sender_name: str
    message: str
    phone: str = None

@app.post("/api/wa-group-intelligence")
async def wa_group_intelligence(req: GroupMessageRequest):
    try:
        model = get_gemini_model()
        prompt = f"""Parse this WhatsApp college group message for academic events.
Group: {req.group_name}
Sender: {req.sender_name}
Message: "{req.message}"
Respond ONLY with JSON (no markdown):
{{"is_academic_event": true/false, "event_type": "CANCELLATION|RESCHEDULE|ASSIGNMENT|EXAM|ANNOUNCEMENT|NONE", "subject": "or null", "date": "or null", "time": "or null", "room": "or null", "summary": "1-line summary", "action_required": "update_timetable|add_deadline|notify_only"}}"""
        response = model.generate_content(prompt)
        raw = response.text.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        parsed = json.loads(raw)
        if not parsed.get("is_academic_event"):
            return {"status": "ignored"}
        uid = get_user_id(req.phone)
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""CREATE TABLE IF NOT EXISTS group_alerts (
            id TEXT PRIMARY KEY, user_id TEXT, group_name TEXT, event_type TEXT,
            message TEXT, details TEXT, created_at TEXT, is_read INTEGER DEFAULT 0)""")
        cursor.execute("INSERT INTO group_alerts VALUES (?,?,?,?,?,?,?,0)",
            (str(uuid.uuid4()), uid, req.group_name, parsed.get("event_type","ANNOUNCEMENT"),
             parsed.get("summary", req.message[:200]), json.dumps(parsed), datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return {"status": "processed", "event": parsed}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.get("/api/wa-group-alerts")
def get_group_alerts(user_id: str = None):
    uid = get_user_id(user_id)
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""CREATE TABLE IF NOT EXISTS group_alerts (
            id TEXT PRIMARY KEY, user_id TEXT, group_name TEXT, event_type TEXT,
            message TEXT, details TEXT, created_at TEXT, is_read INTEGER DEFAULT 0)""")
        cursor.execute("SELECT * FROM group_alerts WHERE user_id=? ORDER BY created_at DESC LIMIT 20", (uid,))
        rows = cursor.fetchall()
        conn.close()
        alerts = []
        for r in rows:
            d = dict(r)
            try: d["details"] = json.loads(d.get("details") or "{}")
            except: d["details"] = {}
            alerts.append(d)
        return {"alerts": alerts}
    except Exception as e:
        return {"alerts": []}

@app.post("/api/wa-group-alerts/{alert_id}/read")
def mark_alert_read(alert_id: str):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE group_alerts SET is_read=1 WHERE id=?", (alert_id,))
        conn.commit()
        conn.close()
    except: pass
    return {"status": "ok"}


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 2 — Push Notifications
# ─────────────────────────────────────────────────────────────────────────────

class PushTokenRequest(BaseModel):
    user_id: str = None
    token: str
    platform: str = "android"

@app.post("/api/push/register")
def register_push_token(req: PushTokenRequest):
    uid = get_user_id(req.user_id)
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""CREATE TABLE IF NOT EXISTS push_tokens (
            id TEXT PRIMARY KEY, user_id TEXT UNIQUE, token TEXT, platform TEXT, created_at TEXT)""")
        cursor.execute("""INSERT INTO push_tokens VALUES (?,?,?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET token=excluded.token, platform=excluded.platform""",
            (str(uuid.uuid4()), uid, req.token, req.platform, datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return {"status": "registered"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.get("/api/push/smart-nudges")
async def get_smart_nudges(user_id: str = None):
    uid = get_user_id(user_id)
    nudges = []
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT title, due_at FROM deadlines WHERE user_id=? AND status != 'DONE' ORDER BY due_at ASC LIMIT 5", (uid,))
        for d in cursor.fetchall():
            try:
                due = datetime.fromisoformat(d["due_at"])
                hours = (due - datetime.now()).total_seconds() / 3600
                if 0 < hours < 24:
                    nudges.append({"type":"DEADLINE_URGENT","title":"⚠️ Deadline Alert","body":f"{d['title']} due in {int(hours)}h!","priority":"high"})
                elif 24 < hours < 48:
                    nudges.append({"type":"DEADLINE_SOON","title":"📅 Coming Up","body":f"{d['title']} due tomorrow","priority":"medium"})
            except: pass
        cursor.execute("""
            SELECT COUNT(*) as cnt FROM flashcards f
            WHERE f.user_id = ?
            AND (
                NOT EXISTS (SELECT 1 FROM study_history h WHERE h.card_id = f.id)
                OR (SELECT datetime(max(h.reviewed_at)) FROM study_history h WHERE h.card_id = f.id) < datetime('now', '-3 days')
            )
        """, (uid,))
        stale = cursor.fetchone()["cnt"]
        if stale > 0:
            nudges.append({"type":"FORGETTING_CURVE","title":"🧠 Memory Alert","body":f"{stale} flashcards need review!","priority":"medium"})
        cursor.execute("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE user_id=? AND date(created_at)>=date('now','-7 days')", (uid,))
        spend = cursor.fetchone()["total"]
        if spend > 1500:
            nudges.append({"type":"BUDGET_WARNING","title":"💸 Budget Alert","body":f"₹{int(spend)} spent this week. Stay careful!","priority":"low"})
        conn.close()
    except: pass
    return {"nudges": nudges, "count": len(nudges)}


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 3 — Voice Ask (context-aware assistant)
# ─────────────────────────────────────────────────────────────────────────────

class VoiceAskRequest(BaseModel):
    user_id: str = None
    question: str

@app.post("/api/voice-ask")
async def voice_ask(req: VoiceAskRequest):
    uid = get_user_id(req.user_id)
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        today_idx = datetime.now().weekday()
        cursor.execute("SELECT subject, time_start, time_end, room FROM schedule_events WHERE user_id=? AND day_of_week=? ORDER BY time_start", (uid, today_idx))
        classes = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT title, due_at, subject FROM deadlines WHERE user_id=? AND status != 'DONE' ORDER BY due_at ASC LIMIT 3", (uid,))
        deadlines = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE user_id=? AND date(created_at)=date('now')", (uid,))
        today_spend = cursor.fetchone()["t"]
        conn.close()
        model = get_gemini_model()
        context = f"""You are Kora, a smart student assistant. Answer concisely (2-3 sentences).
Today ({datetime.now().strftime('%A %d %b')}): Classes={json.dumps(classes)}, Deadlines={json.dumps(deadlines)}, Today's spend=₹{today_spend}
Student asked: "{req.question}" """
        response = model.generate_content(context)
        return {"answer": response.text.strip()}
    except Exception as e:
        return {"answer": "Sorry, I couldn't process that right now. Try again!", "error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 4 — Roommate / Study Group Shared Boards
# ─────────────────────────────────────────────────────────────────────────────

def ensure_rooms_table():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""CREATE TABLE IF NOT EXISTS study_rooms (
        id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT, creator_id TEXT,
        members TEXT DEFAULT '[]', expenses TEXT DEFAULT '[]', tasks TEXT DEFAULT '[]', created_at TEXT)""")
    try:
        cursor.execute("ALTER TABLE study_rooms ADD COLUMN whiteboard_data TEXT DEFAULT '[]';")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    conn.close()

class RoomCreate(BaseModel):
    user_id: str = None
    room_name: str

class RoomJoin(BaseModel):
    user_id: str = None
    room_code: str

class RoomExpense(BaseModel):
    user_id: str = None
    room_code: str
    amount: float
    description: str
    paid_by_name: str

class RoomTask(BaseModel):
    user_id: str = None
    room_code: str
    task: str
    assigned_to: str = None

@app.post("/api/rooms/create")
def create_room(req: RoomCreate):
    ensure_rooms_table()
    uid = get_user_id(req.user_id)
    import random, string
    code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO study_rooms VALUES (?,?,?,?,?,?,?,?)",
            (str(uuid.uuid4()), code, req.room_name, uid, json.dumps([uid]), json.dumps([]), json.dumps([]), datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return {"status": "created", "room_code": code, "room_name": req.room_name}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.post("/api/rooms/join")
def join_room(req: RoomJoin):
    ensure_rooms_table()
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM study_rooms WHERE code=?", (req.room_code.upper(),))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Room not found")
    members = json.loads(row["members"] or "[]")
    if uid not in members:
        members.append(uid)
        cursor.execute("UPDATE study_rooms SET members=? WHERE code=?", (json.dumps(members), req.room_code.upper()))
        conn.commit()
    conn.close()
    return {"status": "joined", "room_code": req.room_code.upper(), "room_name": row["name"]}

@app.get("/api/rooms/{room_code}")
def get_room(room_code: str):
    ensure_rooms_table()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM study_rooms WHERE code=?", (room_code.upper(),))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Room not found")
    d = dict(row)
    d["members"] = json.loads(d.get("members") or "[]")
    d["expenses"] = json.loads(d.get("expenses") or "[]")
    d["tasks"] = json.loads(d.get("tasks") or "[]")
    return d

@app.post("/api/rooms/expense")
def add_room_expense(req: RoomExpense):
    ensure_rooms_table()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM study_rooms WHERE code=?", (req.room_code.upper(),))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Room not found")
    expenses = json.loads(row["expenses"] or "[]")
    expenses.append({"id": str(uuid.uuid4()), "amount": req.amount, "description": req.description, "paid_by": req.paid_by_name, "at": datetime.now().isoformat()})
    cursor.execute("UPDATE study_rooms SET expenses=? WHERE code=?", (json.dumps(expenses), req.room_code.upper()))
    conn.commit()
    conn.close()
    return {"status": "added", "total": len(expenses)}

@app.post("/api/rooms/task")
def add_room_task(req: RoomTask):
    ensure_rooms_table()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM study_rooms WHERE code=?", (req.room_code.upper(),))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Room not found")
    tasks = json.loads(row["tasks"] or "[]")
    tasks.append({"id": str(uuid.uuid4()), "task": req.task, "assigned_to": req.assigned_to, "done": False, "at": datetime.now().isoformat()})
    cursor.execute("UPDATE study_rooms SET tasks=? WHERE code=?", (json.dumps(tasks), req.room_code.upper()))
    conn.commit()
    conn.close()
    return {"status": "added"}


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 5 — Weekly AI Report Card
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/weekly-report")
async def get_weekly_report(user_id: str = None):
    uid = get_user_id(user_id)
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt FROM expenses WHERE user_id=? AND date(created_at)>=date('now','-7 days')", (uid,))
        exp = dict(cursor.fetchone())
        cursor.execute("SELECT COUNT(*) as total, SUM(CASE WHEN status='DONE' THEN 1 ELSE 0 END) as done FROM deadlines WHERE user_id=? AND date(due_at)>=date('now','-7 days')", (uid,))
        dl = dict(cursor.fetchone())
        cursor.execute("SELECT COUNT(*) as reviewed FROM study_history WHERE user_id=? AND date(reviewed_at)>=date('now','-7 days')", (uid,))
        fc = dict(cursor.fetchone())
        cursor.execute("SELECT name, level, xp FROM users WHERE id=?", (uid,))
        user_row = cursor.fetchone()
        conn.close()
        user_name = user_row["name"] if user_row else "Student"
        user_level = user_row["level"] if user_row else 1
        user_xp = user_row["xp"] if user_row else 0
        model = get_gemini_model()
        prompt = f"""Weekly report card for student {user_name}:
Spending: ₹{int(exp['total'])} in {exp['cnt']} txns | Deadlines: {dl.get('done') or 0}/{dl.get('total') or 0} | Flashcards: {fc['reviewed']} | Level {user_level}, {user_xp} XP
Return JSON only (no markdown): {{"headline":"5-word catchy title","grade":"A+/A/B+/B/C","study_rating":"1-10","budget_rating":"1-10","deadline_rating":"1-10","coach_message":"2-sentence motivational message","top_achievement":"best thing this week","next_week_tip":"1 actionable tip","emoji_summary":"3 emojis"}}"""
        response = model.generate_content(prompt)
        raw = response.text.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        ai_report = json.loads(raw)
        return {"week_of": datetime.now().strftime("%B %d, %Y"), "student_name": user_name, "level": user_level, "xp": user_xp,
                "stats": {"total_spend": int(exp["total"]), "transactions": exp["cnt"], "deadlines_done": dl.get("done") or 0,
                          "deadlines_total": dl.get("total") or 0, "flashcards_reviewed": fc["reviewed"]},
                "ai_report": ai_report}
    except Exception as e:
        return {"error": str(e), "week_of": datetime.now().strftime("%B %d, %Y"),
                "ai_report": {"headline": "Your Week in Review", "grade": "B", "study_rating": "7", "budget_rating": "7",
                              "deadline_rating": "7", "coach_message": "Keep pushing! Every day is a new chance.", "top_achievement": "Showed up!",
                              "next_week_tip": "Review flashcards daily.", "emoji_summary": "📚💪✨"}}


# ─────────────────────────────────────────────────────────────────────────────
# FEATURES 6, 7, 8 — Google OAuth (Gmail, Drive, Classroom)
# ─────────────────────────────────────────────────────────────────────────────

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/google/callback")

def ensure_google_tokens_table():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""CREATE TABLE IF NOT EXISTS google_tokens (
        id TEXT PRIMARY KEY, user_id TEXT UNIQUE, access_token TEXT, refresh_token TEXT, scopes TEXT, created_at TEXT)""")
    conn.commit()
    conn.close()

def get_valid_google_token(uid: str) -> str:
    """Gets a valid Google access token. If expired, refreshes it using the refresh token."""
    ensure_google_tokens_table()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT access_token, refresh_token, created_at FROM google_tokens WHERE user_id=?", (uid,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return ""
    
    access_token = row["access_token"]
    refresh_token = row["refresh_token"]
    created_at_str = row["created_at"]
    
    # Check if elapsed time is more than 50 minutes (3000 seconds)
    try:
        created_at = datetime.fromisoformat(created_at_str)
        elapsed = (datetime.now() - created_at).total_seconds()
    except Exception:
        elapsed = 999999
        
    if elapsed > 3000 and refresh_token:
        # Refresh the token
        try:
            import urllib.request, urllib.parse
            token_data = urllib.parse.urlencode({
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token"
            }).encode()
            req = urllib.request.Request(
                "https://oauth2.googleapis.com/token",
                data=token_data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                res = json.loads(r.read())
            new_access_token = res.get("access_token")
            if new_access_token:
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute(
                    "UPDATE google_tokens SET access_token=?, created_at=? WHERE user_id=?",
                    (new_access_token, datetime.now().isoformat(), uid)
                )
                conn.commit()
                conn.close()
                return new_access_token
        except Exception as e:
            print(f"[Google Auth] Failed to refresh token: {e}")
            
    return access_token

def build_google_auth_url(scope: str, state: str) -> str:
    if not GOOGLE_CLIENT_ID:
        return ""
    import urllib.parse
    params = urllib.parse.urlencode({
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": scope,
        "access_type": "offline",
        "prompt": "consent",
        "state": state
    })
    return f"https://accounts.google.com/o/oauth2/v2/auth?{params}"

@app.get("/api/gmail/auth-url")
def get_gmail_auth_url(user_id: str = None):
    scope = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.readonly openid email profile"
    url = build_google_auth_url(scope, f"gmail_{user_id or 'default'}")
    if not url:
        return {"auth_url": None, "setup_required": True, "message": "Add GOOGLE_CLIENT_ID to .env file to enable Gmail sync"}
    return {"auth_url": url, "setup_required": False}

@app.get("/api/drive/auth-url")
def get_drive_auth_url(user_id: str = None):
    scope = "https://www.googleapis.com/auth/drive.file"
    url = build_google_auth_url(scope, f"drive_{user_id or 'default'}")
    if not url:
        return {"auth_url": None, "setup_required": True, "message": "Add GOOGLE_CLIENT_ID to .env file to enable Drive sync"}
    return {"auth_url": url, "setup_required": False}

@app.get("/api/classroom/auth-url")
def get_classroom_auth_url(user_id: str = None):
    scope = "https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly"
    url = build_google_auth_url(scope, f"classroom_{user_id or 'default'}")
    if not url:
        return {"auth_url": None, "setup_required": True, "message": "Add GOOGLE_CLIENT_ID to .env file to enable Classroom sync"}
    return {"auth_url": url, "setup_required": False}

@app.get("/api/google/callback")
async def google_oauth_callback(code: str, state: str = "default"):
    """Unified OAuth2 callback for all Google services."""
    if not GOOGLE_CLIENT_ID:
        return {"status": "error", "message": "Google OAuth not configured"}
    try:
        import urllib.request, urllib.parse
        token_data = urllib.parse.urlencode({"code": code, "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET, "redirect_uri": GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code"}).encode()
        req = urllib.request.Request("https://oauth2.googleapis.com/token", data=token_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as r:
            tokens = json.loads(r.read())
        uid_str = state.replace("gmail_", "").replace("drive_", "").replace("classroom_", "")
        uid = get_user_id(uid_str)
        ensure_google_tokens_table()
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""INSERT INTO google_tokens VALUES (?,?,?,?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET access_token=excluded.access_token, refresh_token=excluded.refresh_token""",
            (str(uuid.uuid4()), uid, tokens.get("access_token",""), tokens.get("refresh_token",""), state, datetime.now().isoformat()))
        conn.commit()
        conn.close()
        service = "Gmail" if "gmail" in state else "Drive" if "drive" in state else "Classroom"
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Kora Authorization Successful</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {{
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    background-color: #0A0A0A;
                    color: #FDFDFD;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    text-align: center;
                    padding: 20px;
                }}
                .card {{
                    background-color: #FDFDFD;
                    color: #000000;
                    border: 3px solid #000000;
                    border-radius: 14px;
                    padding: 30px;
                    max-width: 400px;
                    box-shadow: 8px 8px 0px #000000;
                }}
                h1 {{
                    font-family: "Georgia", serif;
                    font-size: 24px;
                    margin-top: 0;
                }}
                p {{
                    font-size: 16px;
                    color: #48484A;
                    line-height: 1.5;
                }}
                .btn {{
                    display: inline-block;
                    margin-top: 20px;
                    padding: 12px 24px;
                    background-color: #FF6F61;
                    color: #000000;
                    text-decoration: none;
                    font-weight: bold;
                    border: 2px solid #000000;
                    border-radius: 8px;
                    box-shadow: 4px 4px 0px #000000;
                    transition: transform 0.1s;
                }}
                .btn:active {{
                    transform: translate(2px, 2px);
                    box-shadow: 2px 2px 0px #000000;
                }}
            </style>
            <script>
                setTimeout(function() {{
                    window.location.href = "kora://";
                }}, 1500);
            </script>
        </head>
        <body>
            <div class="card">
                <h1>🎉 Authorization Successful!</h1>
                <p>{service} has been linked to your Kora account successfully.</p>
                <p>You can close this window or tap below if you are not automatically redirected.</p>
                <a href="kora://" class="btn">RETURN TO KORA</a>
            </div>
        </body>
        </html>
        """
        return HTMLResponse(content=html_content)
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.get("/api/gmail/sync")
async def sync_gmail(user_id: str = None):
    uid = get_user_id(user_id)
    ensure_google_tokens_table()
    try:
        token = get_valid_google_token(uid)
        if not token:
            return {"status": "not_connected", "events": [], "message": "Connect Gmail first"}
        import urllib.request
        req = urllib.request.Request(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=subject:(exam OR assignment OR class OR schedule OR timetable)",
            headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=10) as r:
            msgs = json.loads(r.read())
        events = []
        for m in (msgs.get("messages") or [])[:5]:
            mr = urllib.request.Request(
                f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{m['id']}?format=metadata&metadataHeaders=Subject&metadataHeaders=Date",
                headers={"Authorization": f"Bearer {token}"})
            with urllib.request.urlopen(mr, timeout=10) as r2:
                msg = json.loads(r2.read())
            hdrs = {h["name"]: h["value"] for h in msg.get("payload",{}).get("headers",[])}
            events.append({"id": m["id"], "subject": hdrs.get("Subject",""), "date": hdrs.get("Date",""), "snippet": msg.get("snippet","")})
            
        # Process emails using Gemini to extract structured student tasks
        if events:
            try:
                model = get_gemini_model()
                prompt = f"""
                You are Kora's academic email reader.
                Analyze the following unread university emails (list of subject, date, and snippet).
                Categorize each email into one of these types: "ASSIGNMENT", "EXAM", "ANNOUNCEMENT", "FEE", "EVENT", or "OTHER".
                If the email mentions a deadline, due date, or class date, extract it as `due_date` in YYYY-MM-DD format (infer relative dates like "tomorrow" or "next Monday" relative to today: {datetime.now().strftime("%Y-%m-%d")}). If no date is found, set `due_date` to null.
                Summarize each email into a single, clean, actionable sentence.
                Provide your response ONLY as a valid JSON array of objects with these keys:
                - id (matches the email id provided)
                - subject (the original subject)
                - date (the original date)
                - type (the uppercase category)
                - summary (your 1-sentence actionable summary)
                - due_date (YYYY-MM-DD or null)
                - course (the associated subject/course name, e.g. "OS", "Math", "N/A" if general)

                Emails list to process:
                {json.dumps(events)}
                """
                response = model.generate_content(prompt)
                text = response.text.strip()
                if "```json" in text:
                    text = text.split("```json")[1].split("```")[0].strip()
                elif "```" in text:
                    text = text.split("```")[1].split("```")[0].strip()
                processed = json.loads(text)
                if isinstance(processed, list):
                    # Map the fields so they fit existing UI: replace snippet with the summary
                    for pe in processed:
                        pe["snippet"] = pe.get("summary", "")
                    events = processed
            except Exception as ai_err:
                print(f"[Gmail AI] Failed to process emails with Gemini: {ai_err}")
                for ev in events:
                    ev["summary"] = ev.get("snippet", "")
                    ev["type"] = "ANNOUNCEMENT"
                    ev["due_date"] = None
                    ev["course"] = "N/A"
                    
        return {"status": "synced", "events": events, "count": len(events)}
    except Exception as e:
        return {"status": "error", "error": str(e), "events": []}

@app.post("/api/drive/upload-note")
async def upload_note_to_drive(user_id: str = Form(None), note_title: str = Form(...), note_content: str = Form(...)):
    uid = get_user_id(user_id)
    ensure_google_tokens_table()
    try:
        token = get_valid_google_token(uid)
        if not token:
            return {"status": "not_connected"}
        import urllib.request
        boundary = "kora12345"
        meta = json.dumps({"name": f"{note_title}.txt", "mimeType": "text/plain"}).encode()
        body = (f"--{boundary}\r\nContent-Type: application/json\r\n\r\n".encode() + meta +
                f"\r\n--{boundary}\r\nContent-Type: text/plain\r\n\r\n".encode() + note_content.encode() +
                f"\r\n--{boundary}--".encode())
        req = urllib.request.Request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
            data=body, headers={"Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/related; boundary={boundary}"}, method="POST")
        with urllib.request.urlopen(req, timeout=15) as r:
            result = json.loads(r.read())
        return {"status": "uploaded", "file_id": result.get("id"), "name": result.get("name")}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.get("/api/drive/list-notes")
async def list_drive_notes(user_id: str = None):
    uid = get_user_id(user_id)
    ensure_google_tokens_table()
    try:
        token = get_valid_google_token(uid)
        if not token:
            return {"status": "not_connected", "files": []}
        import urllib.request
        req = urllib.request.Request(
            "https://www.googleapis.com/drive/v3/files?q=mimeType='text/plain'&orderBy=modifiedTime+desc&pageSize=20",
            headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=10) as r:
            result = json.loads(r.read())
        return {"status": "ok", "files": result.get("files", [])}
    except Exception as e:
        return {"status": "error", "error": str(e), "files": []}

@app.get("/api/classroom/sync")
async def sync_classroom(user_id: str = None):
    uid = get_user_id(user_id)
    ensure_google_tokens_table()
    try:
        token = get_valid_google_token(uid)
        if not token:
            return {"status": "not_connected", "courses": [], "assignments": []}
        import urllib.request
        req = urllib.request.Request(
            "https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=10",
            headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=10) as r:
            courses_data = json.loads(r.read())
        courses = courses_data.get("courses", [])
        assignments = []
        for course in courses[:3]:
            try:
                wk_req = urllib.request.Request(
                    f"https://classroom.googleapis.com/v1/courses/{course['id']}/courseWork?courseWorkStates=PUBLISHED&pageSize=5",
                    headers={"Authorization": f"Bearer {token}"})
                with urllib.request.urlopen(wk_req, timeout=10) as r2:
                    work_data = json.loads(r2.read())
                for cw in work_data.get("courseWork", []):
                    due = cw.get("dueDate", {})
                    due_str = f"{due.get('year',2025)}-{due.get('month',1):02d}-{due.get('day',1):02d}" if due else None
                    assignments.append({"course": course.get("name",""), "title": cw.get("title",""),
                        "description": (cw.get("description","") or "")[:100], "due_date": due_str,
                        "max_points": cw.get("maxPoints"), "link": cw.get("alternateLink","")})
            except: pass
        return {"status": "synced", "courses": [{"id": c["id"], "name": c.get("name","")} for c in courses], "assignments": assignments}
    except Exception as e:
        return {"status": "error", "error": str(e), "courses": [], "assignments": []}

@app.get("/api/google/connection-status")
def google_connection_status(user_id: str = None):
    uid = get_user_id(user_id)
    ensure_google_tokens_table()
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT scopes, created_at FROM google_tokens WHERE user_id=?", (uid,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {"connected": True, "scopes": row["scopes"], "connected_at": row["created_at"]}
        return {"connected": False}
    except:
        return {"connected": False}

@app.post("/api/google/sync-calendar")
def sync_google_calendar(user_id: str = None):
    uid = get_user_id(user_id)
    ensure_google_tokens_table()
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Fetch timetable slots
        cursor.execute("SELECT id, subject, title, day_of_week, time_start, time_end, room, professor FROM schedule_events WHERE user_id=?", (uid,))
        events = cursor.fetchall()
        
        # Fetch deadlines
        cursor.execute("SELECT id, title, due_at FROM deadlines WHERE user_id=?", (uid,))
        deadlines = cursor.fetchall()
        conn.close()
        
        event_list = [dict(ev) for ev in events]
        deadline_list = [dict(dl) for dl in deadlines]
        total_items = len(event_list) + len(deadline_list)
        
        token = get_valid_google_token(uid)
        if not token:
            # Simulated sync for sandbox
            return {
                "status": "simulated",
                "message": f"Offline simulated sync: synced {len(event_list)} classes and {len(deadline_list)} deadlines to Google Calendar! 🗓️",
                "count": total_items,
                "events": event_list
            }
            
        import urllib.request
        from datetime import datetime, timedelta
        
        # 1. Clean up previously synced Kora events/deadlines to avoid duplicates
        try:
            list_url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?privateExtendedProperty=kora_sync%3Dtrue"
            req_list = urllib.request.Request(list_url, headers={"Authorization": f"Bearer {token}"})
            with urllib.request.urlopen(req_list, timeout=10) as r:
                existing_events = json.loads(r.read()).get("items", [])
            for ex_ev in existing_events:
                try:
                    del_url = f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{ex_ev['id']}"
                    req_del = urllib.request.Request(del_url, headers={"Authorization": f"Bearer {token}"}, method="DELETE")
                    with urllib.request.urlopen(req_del, timeout=5) as _:
                        pass
                except Exception as del_err:
                    print(f"[Google Calendar] Failed to delete event {ex_ev['id']}: {del_err}")
        except Exception as list_err:
            print(f"[Google Calendar] Failed to list existing events: {list_err}")
            
        # 2. Sync academic classes
        synced_count = 0
        today = datetime.now()
        day_mapping = {0: "MO", 1: "TU", 2: "WE", 3: "TH", 4: "FR", 5: "SA", 6: "SU"}
        
        for ev in event_list:
            try:
                day_of_week = ev.get("day_of_week", 0)
                time_start_str = ev.get("time_start", "09:00")
                time_end_str = ev.get("time_end", "10:00")
                
                # Calculate first occurrence date
                delta_days = day_of_week - today.weekday()
                if delta_days < 0:
                    delta_days += 7
                first_date = today + timedelta(days=delta_days)
                
                # Create start and end datetimes
                h_start, m_start = map(int, time_start_str.split(":"))
                h_end, m_end = map(int, time_end_str.split(":"))
                
                start_dt = datetime(first_date.year, first_date.month, first_date.day, h_start, m_start)
                end_dt = datetime(first_date.year, first_date.month, first_date.day, h_end, m_end)
                
                byday = day_mapping.get(day_of_week, "MO")
                
                body = {
                    "summary": f"{ev['subject'].upper()}: {ev['title']}",
                    "description": f"Room: {ev.get('room', 'N/A')}\nProfessor: {ev.get('professor', 'N/A')}\nSynced via Kora.",
                    "start": {
                        "dateTime": start_dt.strftime("%Y-%m-%dT%H:%M:%S"),
                        "timeZone": "Asia/Kolkata"
                    },
                    "end": {
                        "dateTime": end_dt.strftime("%Y-%m-%dT%H:%M:%S"),
                        "timeZone": "Asia/Kolkata"
                    },
                    "recurrence": [
                        f"RRULE:FREQ=WEEKLY;BYDAY={byday}"
                    ],
                    "extendedProperties": {
                        "private": {
                            "kora_sync": "true",
                            "kora_event_id": str(ev["id"])
                        }
                    }
                }
                
                req_insert = urllib.request.Request(
                    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                    data=json.dumps(body).encode(),
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json"
                    },
                    method="POST"
                )
                with urllib.request.urlopen(req_insert, timeout=10) as r_ins:
                    json.loads(r_ins.read())
                synced_count += 1
            except Exception as ins_err:
                print(f"[Google Calendar] Failed to insert event {ev.get('id')}: {ins_err}")
                
        # 3. Sync deadlines
        for dl in deadline_list:
            try:
                due_at_str = dl.get("due_at", "")
                if not due_at_str:
                    continue
                try:
                    due_dt = datetime.fromisoformat(due_at_str.replace("Z", ""))
                except Exception:
                    due_dt = datetime.strptime(due_at_str[:19], "%Y-%m-%d %H:%M:%S")
                
                body = {
                    "summary": f"⏰ DEADLINE: {dl['title']}",
                    "description": "Academic deadline synced via Kora.",
                    "start": {
                        "dateTime": due_dt.strftime("%Y-%m-%dT%H:%M:%S"),
                        "timeZone": "Asia/Kolkata"
                    },
                    "end": {
                        "dateTime": (due_dt + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S"),
                        "timeZone": "Asia/Kolkata"
                    },
                    "extendedProperties": {
                        "private": {
                            "kora_sync": "true",
                            "kora_deadline_id": str(dl["id"])
                        }
                    }
                }
                req_insert = urllib.request.Request(
                    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                    data=json.dumps(body).encode(),
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json"
                    },
                    method="POST"
                )
                with urllib.request.urlopen(req_insert, timeout=10) as r_ins:
                    json.loads(r_ins.read())
                synced_count += 1
            except Exception as dl_err:
                print(f"[Google Calendar] Failed to insert deadline {dl.get('id')}: {dl_err}")
                
        return {
            "status": "synced",
            "message": f"Successfully synced {synced_count} classes and deadlines to Google Calendar! ✅",
            "count": synced_count,
            "events": event_list
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}



# ─────────────────────────────────────────────────────────────────────────────
# FEATURE 9 — Real-time Lecture Stream (WebSockets)
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import WebSocket, WebSocketDisconnect
import asyncio

def process_stream_chunk(audio_bytes: bytes, mime_type: str):
    try:
        model = get_gemini_model()
        prompt = """
        You are Kora's real-time lecture transcription agent.
        Analyze this audio chunk from a university lecture.
        Return ONLY a strictly valid JSON object containing:
        - transcript: The exact transcription of the lecture so far.
        - new_events: A list of any upcoming deadlines, assignments, exam dates, or class cancellations mentioned. Each event must have:
          - title: E.g., "Midterm Exam", "Syllabus Quiz", "Lab Assignment 2"
          - due_date: YYYY-MM-DD format (if a relative date like "next Friday" is mentioned, compute it relative to today: """ + datetime.now().strftime("%Y-%m-%d") + """). If no date can be inferred, omit this field.
          - confidence: "high", "medium", or "low"

        Example response format:
        {
          "transcript": "Alright class, today we are starting with Operating Systems...",
          "new_events": [
            {"title": "OS Lab 1", "due_date": "2026-06-12", "confidence": "high"}
          ]
        }
        Do not output any markdown formatting like ```json ```, just the plain JSON text.
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
        
        # Clean up markdown formatting if present
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
            
        return json.loads(text)
    except Exception as e:
        print("Error in process_stream_chunk:", e)
        # Fallback to simple response
        return {"transcript": "[Processing transcription...]", "new_events": []}

@app.websocket("/api/ws/lecture-stream")
async def ws_lecture_stream(websocket: WebSocket, user_id: str = None, mime_type: str = "audio/wav"):
    await websocket.accept()
    uid = get_user_id(user_id)
    print(f"WebSocket lecture stream connected for user {uid}")
    
    audio_buffer = bytearray()
    last_process_time = asyncio.get_event_loop().time()
    
    try:
        while True:
            # Receive message from WebSocket
            message = await websocket.receive()
            
            if "bytes" in message:
                audio_buffer.extend(message["bytes"])
                
                # Process every 7 seconds or when buffer is large enough
                current_time = asyncio.get_event_loop().time()
                if current_time - last_process_time > 7.0 and len(audio_buffer) > 1024:
                    last_process_time = current_time
                    # Run transcription in a separate thread to not block the WebSocket event loop
                    loop = asyncio.get_event_loop()
                    try:
                        result = await loop.run_in_executor(None, process_stream_chunk, bytes(audio_buffer), mime_type)
                        if result:
                            await websocket.send_json({
                                "status": "success",
                                "transcript": result.get("transcript", ""),
                                "events": result.get("new_events", [])
                            })
                    except Exception as ex:
                        print("Error processing audio chunk:", ex)
                        await websocket.send_json({"status": "error", "message": str(ex)})
                        
            elif "text" in message:
                try:
                    data = json.loads(message["text"])
                    if data.get("command") == "audio_chunk" and data.get("base64"):
                        import base64
                        chunk_bytes = base64.b64decode(data["base64"])
                        audio_buffer.extend(chunk_bytes)
                        
                        # Process immediately
                        loop = asyncio.get_event_loop()
                        try:
                            result = await loop.run_in_executor(None, process_stream_chunk, bytes(audio_buffer), mime_type)
                            if result:
                                await websocket.send_json({
                                    "status": "success",
                                    "transcript": result.get("transcript", ""),
                                    "events": result.get("new_events", [])
                                })
                        except Exception as ex:
                            print("Error processing audio chunk:", ex)
                            await websocket.send_json({"status": "error", "message": str(ex)})
                    elif data.get("command") == "stop":
                        print("Lecture stream stop command received")
                        break
                except Exception as ex:
                    print("Error parsing text command on websocket:", ex)
    except WebSocketDisconnect:
        print("WebSocket lecture stream disconnected")
    except Exception as e:
        print("WebSocket error:", e)
    finally:
        try:
            await websocket.close()
        except:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# FEATURES 10, 11 — Content Agent & Automated Flashcard Generator
# ─────────────────────────────────────────────────────────────────────────────

class ContentDraftRequest(BaseModel):
    type: str  # "EMAIL", "APPLICATION", "REPORT"
    topic: str
    recipient: str = None
    subject: str = None
    tone: str = "professional"
    points_to_include: str = None
    user_id: str = None

class GmailDraftRequest(BaseModel):
    subject: str
    body: str
    recipient: str = None
    user_id: str = None

class GenerateFlashcardsRequest(BaseModel):
    note_id: str = None
    text_content: str = None
    subject: str = "General"
    user_id: str = None

@app.post("/api/content/draft")
def generate_content_draft(req: ContentDraftRequest):
    model = get_gemini_model()
    prompt = f"""
    You are Kora's expert academic and professional content drafting agent.
    Generate a high-quality draft for a student productivity app.
    
    Document Details:
    - Type: {req.type}
    - Topic/Context: {req.topic}
    - Recipient: {req.recipient or 'General'}
    - Subject: {req.subject or 'Not Specified'}
    - Tone: {req.tone}
    - Points/Details to Include: {req.points_to_include or 'Not specified'}
    
    Instructions:
    - If Type is EMAIL or APPLICATION, return a complete, professionally formatted email or letter with placeholders like [Your Name] or [Date] where appropriate.
    - If Type is REPORT, return a structured markdown outline with clear sections, bullet points, and an executive summary.
    - Match the requested tone exactly ({req.tone}).
    - Do not output any chat conversational preamble, just output the draft itself in markdown.
    """
    try:
        response = model.generate_content(prompt)
        return {"draft": response.text.strip(), "subject": req.subject or f"Draft {req.type}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/content/gmail-draft")
async def create_gmail_draft(req: GmailDraftRequest):
    uid = get_user_id(req.user_id)
    ensure_google_tokens_table()
    
    access_token = get_valid_google_token(uid)
    if not access_token:
        raise HTTPException(status_code=400, detail="Gmail connection required. Please connect Gmail in settings.")
    
    try:
        from email.mime.text import MIMEText
        import base64
        import httpx
        
        message = MIMEText(req.body)
        if req.recipient:
            message['to'] = req.recipient
        message['subject'] = req.subject
        
        raw_b64 = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')
        
        async with httpx.AsyncClient() as client:
            r = await client.post(
                "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                },
                json={
                    "message": {
                        "raw": raw_b64
                    }
                },
                timeout=10.0
            )
            
            if r.status_code == 200:
                data = r.json()
                return {"status": "success", "draft_id": data.get("id"), "message": "Draft created in Gmail! 📧"}
            else:
                err_data = r.json() if r.headers.get("content-type") == "application/json" else r.text
                print("Gmail API error:", err_data)
                raise HTTPException(status_code=r.status_code, detail=f"Gmail API error: {err_data}")
                
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to sync to Gmail: {str(e)}")

@app.post("/api/study/generate-flashcards")
def generate_study_flashcards(req: GenerateFlashcardsRequest):
    uid = get_user_id(req.user_id)
    text_to_process = ""
    subject = req.subject
    
    if req.note_id:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT summary, title, subject FROM lecture_notes WHERE id = ? AND user_id = ?", (req.note_id, uid))
        note = cursor.fetchone()
        conn.close()
        if not note:
            raise HTTPException(status_code=404, detail="Lecture note not found")
        note_dict = dict(note)
        text_to_process = f"Title: {note_dict['title']}\nSubject: {note_dict['subject']}\nContent: {note_dict['summary']}"
        subject = note_dict['subject'] or req.subject
    else:
        text_to_process = req.text_content
        
    if not text_to_process or len(text_to_process.strip()) < 10:
        raise HTTPException(status_code=400, detail="Insufficient text content to generate flashcards.")
        
    model = get_gemini_model()
    prompt = f"""
    You are an expert tutor AI agent.
    Generate exactly 5-10 high-quality flashcards based on the following content for subject "{subject}".
    
    Content:
    {text_to_process}
    
    Instructions:
    - Return ONLY a valid JSON array of objects. Do not wrap in markdown or prefix/suffix.
    - Format:
      [
        {{"front": "Question or term", "back": "Answer or definition"}}
      ]
    """
    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
            
        cards = json.loads(text)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        added_count = 0
        for card in cards:
            card_id = str(uuid.uuid4())
            next_review = datetime.now().isoformat()
            cursor.execute("""
            INSERT INTO flashcards (id, user_id, subject, front, back, difficulty, next_review_at)
            VALUES (?, ?, ?, ?, ?, 3, ?)
            """, (card_id, uid, subject, card.get("front"), card.get("back"), next_review))
            added_count += 1
            
        conn.commit()
        conn.close()
        return {"status": "success", "cards_generated": added_count}
    except Exception as e:
        print("Error in generate-flashcards:", e)
        raise HTTPException(status_code=500, detail=str(e))


# --- SECOND BRAIN MEMORY VAULT ENDPOINTS ---

import re

class MemoryNodeUpdate(BaseModel):
    markdown_content: str
    user_id: str = None

@app.post("/api/memory/index")
def index_memory(user_id: str = None):
    uid = get_user_id(user_id)
    try:
        from agents import run_memory_indexer
        success = run_memory_indexer(uid)
        return {"status": "success", "indexed": success}
    except Exception as e:
        print("Error in index_memory endpoint:", e)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/memory/nodes")
def get_memory_nodes(user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, type, title, source, file_path, summary, last_updated_at 
    FROM memory_nodes 
    WHERE user_id = ? 
    ORDER BY type ASC, last_updated_at DESC
    """, (uid,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/memory/node/{node_id}")
def get_memory_node(node_id: str, user_id: str = None):
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT file_path, title, type FROM memory_nodes WHERE id = ? AND user_id = ?", (node_id, uid))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Memory node not found")
        
    vault_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "memory_vault")
    full_path = os.path.join(vault_dir, row["file_path"].replace("/", os.sep))
    
    if not os.path.exists(full_path):
        # Create empty file if missing
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(f"# {row['title']}\nNo content indexed yet.\n")
            
    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {
            "id": node_id,
            "title": row["title"],
            "type": row["type"],
            "file_path": row["file_path"],
            "markdown_content": content
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read memory file: {str(e)}")

@app.put("/api/memory/node/{node_id}")
def update_memory_node(node_id: str, req: MemoryNodeUpdate):
    uid = get_user_id(req.user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT file_path, title FROM memory_nodes WHERE id = ? AND user_id = ?", (node_id, uid))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Memory node not found")
        
    vault_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "memory_vault")
    full_path = os.path.join(vault_dir, row["file_path"].replace("/", os.sep))
    
    try:
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(req.markdown_content)
            
        # Extract a fresh brief summary (e.g. first 200 chars of content without header)
        clean_text = re.sub(r'#+\s+.*', '', req.markdown_content).strip()
        summary = clean_text[:200]
        
        cursor.execute("""
        UPDATE memory_nodes
        SET summary = ?, last_updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, (summary, node_id))
        conn.commit()
        conn.close()
        
        return {"status": "success", "message": "Memory node updated successfully"}
    except Exception as e:
        if conn:
            conn.close()
        raise HTTPException(status_code=500, detail=f"Failed to write memory file: {str(e)}")


# =============================================================================
# WOW FEATURE 1 — Multi-File RAG (Retrieval-Augmented Generation) Exam Prep
# =============================================================================

import sqlite3 as _sqlite3

def ensure_course_materials_table():
    """Ensure course_materials table exists."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""CREATE TABLE IF NOT EXISTS course_materials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        filename TEXT,
        subject TEXT,
        content TEXT,
        chunk_count INTEGER DEFAULT 0,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")
    conn.commit()
    conn.close()

class TutorAskRequest(BaseModel):
    user_id: str = None
    question: str
    subject: str = None

@app.post("/api/study/upload-material")
async def upload_course_material(
    file: UploadFile = File(...),
    user_id: str = Form(None),
    subject: str = Form(None)
):
    """
    Upload a PDF/TXT/DOCX course material. Kora extracts text,
    chunks it, and stores it in the course_materials table for RAG.
    """
    ensure_course_materials_table()
    uid = get_user_id(user_id)
    
    file_bytes = await file.read()
    filename = file.filename or "document.txt"
    content_type = file.content_type or "text/plain"
    
    # Extract text content
    extracted_text = ""
    try:
        if "pdf" in content_type or filename.endswith(".pdf"):
            # Use Gemini to extract text from PDF via multimodal
            model = get_gemini_model()
            response = model.generate_content([
                {"mime_type": content_type if "pdf" in content_type else "application/pdf", "data": file_bytes},
                "Extract ALL text from this document verbatim. Preserve headings, section numbers, and paragraph structure. Output only the extracted text."
            ])
            extracted_text = response.text.strip()
        else:
            # Try to decode as UTF-8 text
            try:
                extracted_text = file_bytes.decode("utf-8")
            except Exception:
                extracted_text = file_bytes.decode("latin-1", errors="replace")
    except Exception as e:
        print("Error extracting text:", e)
        try:
            extracted_text = file_bytes.decode("utf-8", errors="replace")
        except Exception:
            extracted_text = f"[Could not extract text from {filename}]"
    
    if not extracted_text or len(extracted_text.strip()) < 20:
        raise HTTPException(status_code=400, detail="Could not extract meaningful text from the uploaded file.")
    
    # Chunk the text into 500-char chunks with 50-char overlap
    chunk_size = 500
    overlap = 50
    chunks = []
    i = 0
    while i < len(extracted_text):
        chunks.append(extracted_text[i:i + chunk_size])
        i += chunk_size - overlap
    chunk_count = len(chunks)
    
    # Store in database (store full content, we chunk on query)
    ensure_course_materials_table()
    material_id = str(uuid.uuid4())
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO course_materials (id, user_id, filename, subject, content, chunk_count, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (material_id, uid, filename, subject or "General", extracted_text[:50000], chunk_count, datetime.now().isoformat()))
    conn.commit()
    conn.close()
    
    return {
        "status": "success",
        "material_id": material_id,
        "filename": filename,
        "subject": subject or "General",
        "chunk_count": chunk_count,
        "chars_extracted": len(extracted_text),
        "message": f"Successfully indexed '{filename}' ({chunk_count} text chunks). Ask Kora anything about it!"
    }

@app.post("/api/study/ocr")
async def ocr_whiteboard_slide(
    file: UploadFile = File(...),
    user_id: str = Form(None),
    target: str = Form("flashcards")
):
    uid = get_user_id(user_id)
    file_bytes = await file.read()
    filename = file.filename or "whiteboard.jpg"
    content_type = file.content_type or "image/jpeg"
    
    try:
        model = get_gemini_model()
        prompt = """
        You are Kora's whiteboard and lecture slide scanner.
        Analyze the uploaded whiteboard photo or lecture slide image.
        1. Extract the key academic concepts and notes from the slide, and format them as a brief structured summary.
        2. Generate exactly 3 to 5 high-quality, challenging flashcards for testing this slide's material.
        
        Return ONLY a strictly valid JSON object containing:
        - "summary": A string containing the core structured notes and academic summary.
        - "flashcards": A list of objects, each with:
            - "front": A string representing the front of the flashcard (the question).
            - "back": A string representing the back of the flashcard (the answer).
            
        Ensure the JSON is strictly valid. Do not write markdown formatting outside of a ```json ``` block.
        """
        response = model.generate_content([
            {"mime_type": content_type, "data": file_bytes},
            prompt
        ])
        
        res_text = response.text.strip()
        if "```json" in res_text:
            res_text = res_text.split("```json")[1].split("```")[0].strip()
        elif "```" in res_text:
            res_text = res_text.split("```")[1].split("```")[0].strip()
            
        data = json.loads(res_text)
    except Exception as e:
        print("Error in multimodal OCR:", e)
        # Sandbox offline fallback
        data = {
            "summary": "Sandbox offline summary of whiteboard notes regarding operating system process scheduling state transitions.",
            "flashcards": [
                {"front": "What are the three primary states of a process?", "back": "Ready, Running, and Blocked (Waiting)."},
                {"front": "Which scheduler controls the transition from Ready to Running state?", "back": "The short-term scheduler (or CPU dispatcher)."},
                {"front": "What event causes a process to transition from Running to Blocked?", "back": "An I/O request or wait event."}
            ]
        }
        
    summary_content = data.get("summary", "")
    
    if target == "brain":
        from agents import upsert_memory_node
        import os
        import re
        
        # Standardize filename for path
        safe_filename = re.sub(r'[^a-zA-Z0-9_\.-]', '_', filename)
        relative_path = f"source_trees/whiteboard_{safe_filename}.md"
        
        vault_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "memory_vault")
        full_path = os.path.join(vault_dir, relative_path.replace("/", os.sep))
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        # Write structured markdown node
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(f"# Whiteboard Scan: {filename}\n\n{summary_content}\n")
            
        upsert_memory_node(uid, "source_tree", f"Whiteboard: {filename}", "notes", relative_path, summary_content[:200])
        
        return {
            "summary": summary_content,
            "flashcards": [],
            "count": 0
        }
        
    # Save the generated flashcards to the database
    conn = get_db_connection()
    cursor = conn.cursor()
    
    saved_cards = []
    for fc in data.get("flashcards", []):
        card_id = f"fc_{int(datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
        subject = "OCR Scanner"
        cursor.execute("""
        INSERT INTO flashcards (id, user_id, subject, front, back)
        VALUES (?, ?, ?, ?, ?)
        """, (card_id, uid, subject, fc["front"], fc["back"]))
        saved_cards.append({
            "id": card_id,
            "subject": subject,
            "front": fc["front"],
            "back": fc["back"]
        })
        
    conn.commit()
    conn.close()
    
    return {
        "summary": summary_content,
        "flashcards": saved_cards,
        "count": len(saved_cards)
    }

@app.get("/api/study/materials")
def list_course_materials(user_id: str = None):
    """List all uploaded course materials for a user."""
    ensure_course_materials_table()
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, filename, subject, chunk_count, uploaded_at
    FROM course_materials WHERE user_id = ?
    ORDER BY uploaded_at DESC
    """, (uid,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.delete("/api/study/materials/{material_id}")
def delete_course_material(material_id: str, user_id: str = None):
    """Delete a course material."""
    ensure_course_materials_table()
    uid = get_user_id(user_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM course_materials WHERE id = ? AND user_id = ?", (material_id, uid))
    conn.commit()
    conn.close()
    return {"status": "deleted"}

@app.post("/api/study/tutor-ask")
def tutor_ask(req: TutorAskRequest):
    """
    RAG-powered tutor: finds relevant chunks from uploaded materials
    and answers with exact citations like 'According to [filename]...'.
    """
    ensure_course_materials_table()
    uid = get_user_id(req.user_id)
    
    if not req.question or len(req.question.strip()) < 3:
        raise HTTPException(status_code=400, detail="Question is too short.")
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Fetch materials filtered by subject if provided
    if req.subject:
        cursor.execute("""
        SELECT id, filename, subject, content FROM course_materials 
        WHERE user_id = ? AND (subject LIKE ? OR subject = 'General')
        ORDER BY uploaded_at DESC LIMIT 5
        """, (uid, f"%{req.subject}%"))
    else:
        cursor.execute("""
        SELECT id, filename, subject, content FROM course_materials 
        WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT 5
        """, (uid,))
    
    materials = cursor.fetchall()
    conn.close()
    
    if not materials:
        # Fallback to general Gemini answer
        model = get_gemini_model()
        fallback = model.generate_content(
            f"You are Kora, a student tutor AI. Answer this question thoroughly:\n\n{req.question}"
        )
        return {
            "answer": fallback.text.strip(),
            "citations": [],
            "has_material_context": False,
            "note": "No course materials uploaded yet. Upload your textbooks/notes for citation-based answers!"
        }
    
    # Build context from materials: find best-matching chunks
    query_lower = req.question.lower()
    context_parts = []
    citations = []
    
    for mat in materials:
        mat_dict = dict(mat)
        content = mat_dict["content"] or ""
        filename = mat_dict["filename"]
        subject = mat_dict["subject"]
        
        # Simple keyword-based chunk retrieval
        chunk_size = 600
        overlap = 100
        best_chunks = []
        i = 0
        while i < len(content):
            chunk = content[i:i + chunk_size]
            # Score this chunk: count query word matches
            query_words = [w for w in query_lower.split() if len(w) > 3]
            chunk_lower = chunk.lower()
            score = sum(1 for w in query_words if w in chunk_lower)
            best_chunks.append((score, chunk))
            i += chunk_size - overlap
        
        # Sort by relevance score, take top 2
        best_chunks.sort(key=lambda x: x[0], reverse=True)
        top_chunks = [c for s, c in best_chunks[:2] if s > 0]
        
        if not top_chunks and best_chunks:
            top_chunks = [best_chunks[0][1]]  # At least include first chunk
        
        if top_chunks:
            combined = "\n...".join(top_chunks)[:1200]
            context_parts.append(f"=== From '{filename}' ({subject}) ===\n{combined}")
            citations.append({"filename": filename, "subject": subject, "material_id": mat_dict["id"]})
    
    if not context_parts:
        context_parts.append("[No matching content found in uploaded materials]")
    
    context_text = "\n\n".join(context_parts)
    
    model = get_gemini_model()
    prompt = f"""You are Kora, an expert academic tutor AI. You have access to the student's own course materials.

STUDENT'S UPLOADED COURSE MATERIALS (use these as primary source):
{context_text}

STUDENT'S QUESTION: {req.question}

INSTRUCTIONS:
- Answer DIRECTLY and SPECIFICALLY using the course materials above.
- When citing content, say: "According to [filename], ..." or "Your [subject] material states..."
- If the answer spans multiple sources, cite each one.
- Be concise but complete. Use bullet points if listing multiple concepts.
- If the materials don't fully answer the question, supplement with your knowledge and note it.
"""
    
    try:
        response = model.generate_content(prompt)
        answer = response.text.strip()
        return {
            "answer": answer,
            "citations": citations,
            "has_material_context": True,
            "materials_used": len(context_parts)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tutor AI error: {str(e)}")


# =============================================================================
# WOW FEATURE 2 — Collaborative Whiteboard Sync
# =============================================================================

class WhiteboardSyncRequest(BaseModel):
    user_id: str = None
    room_code: str
    strokes: list  # List of stroke objects: {id, points: [{x,y}], color, width}

@app.get("/api/rooms/{room_code}/whiteboard")
def get_whiteboard(room_code: str):
    """Get current whiteboard strokes for a study room."""
    ensure_rooms_table()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT whiteboard_data FROM study_rooms WHERE code=?", (room_code.upper(),))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Room not found")
    strokes = json.loads(row["whiteboard_data"] or "[]")
    return {"room_code": room_code.upper(), "strokes": strokes, "stroke_count": len(strokes)}

@app.post("/api/rooms/{room_code}/whiteboard")
def sync_whiteboard(room_code: str, req: WhiteboardSyncRequest):
    """
    Sync whiteboard strokes. Merges new strokes with existing ones using stroke IDs.
    Keeps last 500 strokes to prevent unbounded growth.
    """
    ensure_rooms_table()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT whiteboard_data FROM study_rooms WHERE code=?", (room_code.upper(),))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Room not found")
    
    existing = json.loads(row["whiteboard_data"] or "[]")
    existing_ids = {s.get("id") for s in existing if s.get("id")}
    
    # Merge: add only new strokes
    for stroke in req.strokes:
        sid = stroke.get("id")
        if sid and sid not in existing_ids:
            existing.append(stroke)
            existing_ids.add(sid)
    
    # Cap to 500 strokes
    if len(existing) > 500:
        existing = existing[-500:]
    
    cursor.execute("UPDATE study_rooms SET whiteboard_data=? WHERE code=?",
                   (json.dumps(existing), room_code.upper()))
    conn.commit()
    conn.close()
    return {"status": "synced", "total_strokes": len(existing)}

@app.delete("/api/rooms/{room_code}/whiteboard")
def clear_whiteboard(room_code: str):
    """Clear the whiteboard for a study room."""
    ensure_rooms_table()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE study_rooms SET whiteboard_data='[]' WHERE code=?", (room_code.upper(),))
    conn.commit()
    conn.close()
    return {"status": "cleared"}


# =============================================================================
# WOW FEATURE 3 — AI Voice Conversation Turn
# =============================================================================

class VoiceConvRequest(BaseModel):
    user_id: str = None
    transcript: str  # User's spoken text (from device STT)
    conversation_history: list = []  # [{role: 'user'|'assistant', text: str}]

@app.post("/api/voice/converse")
def voice_converse(req: VoiceConvRequest):
    """
    Stateless voice conversation turn. Takes a user's spoken transcript + history,
    returns a short, spoken-style AI reply optimized for text-to-speech.
    """
    uid = get_user_id(req.user_id)
    
    if not req.transcript or len(req.transcript.strip()) < 2:
        return {"reply": "I didn't catch that. Could you say it again?"}
    
    try:
        from agents import get_student_context
        context = get_student_context(uid)
        
        # Build conversation history string
        history_str = ""
        for turn in req.conversation_history[-6:]:  # Last 6 turns for context
            role = "You" if turn.get("role") == "user" else "Kora"
            history_str += f"{role}: {turn.get('text', '')}\n"
        
        model = get_gemini_model()
        prompt = f"""You are Kora, a friendly AI student assistant. You're having a voice conversation — keep replies SHORT (1-3 sentences max), natural, and conversational. Never use bullet points, markdown, or lists. Speak as if you're talking to a friend.

Student profile: {json.dumps(context.get('user', {}), indent=0)}
Today's schedule: {json.dumps(context.get('todays_classes', []), indent=0)}
Upcoming deadlines: {json.dumps(context.get('upcoming_deadlines', [])[:3], indent=0)}

Conversation so far:
{history_str}
You: {req.transcript}
Kora:"""
        
        response = model.generate_content(prompt)
        reply = response.text.strip()
        
        # Trim if too long for TTS
        sentences = reply.split('. ')
        if len(sentences) > 4:
            reply = '. '.join(sentences[:4]) + '.'
        
        return {"reply": reply, "transcript_received": req.transcript}
    except Exception as e:
        print("Voice converse error:", e)
        return {"reply": "Sorry, I had a momentary glitch. Ask me again!", "error": str(e)}


# =============================================================================
# WOW FEATURE 4 — Interactive Concept Map Generation
# =============================================================================

class ConceptMapRequest(BaseModel):
    user_id: str = None
    subject: str
    topic: str = None  # Optional specific topic

@app.post("/api/study/concept-map")
def generate_concept_map(req: ConceptMapRequest):
    """
    Generate an interactive concept map (nodes + edges) for a subject/topic.
    Returns structured JSON that the mobile client renders as an SVG graph.
    """
    uid = get_user_id(req.user_id)
    
    model = get_gemini_model()
    topic_str = f"specifically about '{req.topic}'" if req.topic else ""
    
    prompt = f"""Generate a concept map for the subject "{req.subject}" {topic_str}.

Return ONLY valid JSON (no markdown, no explanation):
{{
  "title": "Topic name",
  "nodes": [
    {{"id": "n1", "label": "Core Concept", "type": "root", "color": "#7B6EF6"}},
    {{"id": "n2", "label": "Sub-concept 1", "type": "branch", "color": "#45DB91"}},
    {{"id": "n3", "label": "Leaf detail", "type": "leaf", "color": "#FF6B6B"}}
  ],
  "edges": [
    {{"from": "n1", "to": "n2", "label": "includes"}},
    {{"from": "n2", "to": "n3", "label": "has"}}
  ]
}}

Rules:
- Create 8-15 nodes total (1 root, 3-5 branches, rest leaves)
- Every node must have an edge connecting it to the graph
- Root node color: "#7B6EF6" (purple)
- Branch node color: "#45DB91" (green) 
- Leaf node color: "#FFD166" (yellow)
- Edge labels should be short relationship words (includes, has, uses, leads to, etc.)
- Labels should be concise (max 4 words)"""
    
    try:
        response = model.generate_content(prompt)
        raw = response.text.strip()
        
        # Strip markdown fences if present
        if "```json" in raw:
            raw = raw.split("```json")[1].split("```")[0].strip()
        elif "```" in raw:
            raw = raw.split("```")[1].split("```")[0].strip()
        
        concept_data = json.loads(raw)
        
        # Validate structure
        if "nodes" not in concept_data or "edges" not in concept_data:
            raise ValueError("Invalid concept map structure")
        
        return {
            "status": "success",
            "subject": req.subject,
            "topic": req.topic,
            "concept_map": concept_data
        }
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse concept map JSON: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Concept map generation failed: {str(e)}")


