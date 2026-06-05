import time
import requests
import tkinter as tk
import os
import sqlite3
import datetime as dt

API_URL = "http://localhost:8000/api/chat"

def get_clipboard_text():
    try:
        root = tk.Tk()
        root.withdraw()
        text = root.clipboard_get()
        root.destroy()
        return text
    except Exception:
        return None
        
def main():
    print("Kora Laptop Clipboard & Proactive Reminder Watcher Daemon active...")
    last_text = ""
    last_deadline_check = 0
    sent_reminders = set() # Store reminded deadline IDs in memory
    
    # Relevant keywords to trigger auto-ingestion
    keywords = ["due", "assignment", "homework", "exam", "quiz", "test", "project", "deadline", 
                "paid", "bill", "split", "canteen", "mess", "rupees", "rs.", "cost", "spent",
                "class", "lecture", "lab", "timetable", "schedule"]
                
    while True:
        # 1. Clipboard Sync Logic
        try:
            text = get_clipboard_text()
            if text and text != last_text:
                last_text = text
                text_lower = text.lower()
                
                # Filter for relevant student circulars/messages
                if any(kw in text_lower for kw in keywords):
                    print(f"Auto-detected copied student circular: '{text[:60]}...'")
                    
                    # Post to Kora chat system
                    payload = {
                        "message": f"System Clipboard Capture: {text}"
                    }
                    res = requests.post(API_URL, json=payload)
                    if res.status_code == 200:
                        reply = res.json().get("reply")
                        print(f"Kora agent sync response: {reply}")
                    else:
                        print(f"FastAPI sync error {res.status_code}: {res.text}")
        except Exception as e:
            print(f"Clipboard watcher error: {e}")
            
        # 2. Proactive WhatsApp Alerts Logic (Every 60 seconds)
        current_time = time.time()
        if current_time - last_deadline_check > 60:
            last_deadline_check = current_time
            try:
                db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kora.db")
                if os.path.exists(db_path):
                    conn = sqlite3.connect(db_path)
                    conn.row_factory = sqlite3.Row
                    cursor = conn.cursor()
                    
                    # Fetch deadlines and user phones
                    cursor.execute("""
                    SELECT d.id, d.title, d.due_at, u.phone_number 
                    FROM deadlines d
                    JOIN users u ON d.user_id = u.id
                    WHERE d.status = 'PENDING'
                    """)
                    deadlines = cursor.fetchall()
                    conn.close()
                    
                    for row in deadlines:
                        dl_id = row["id"]
                        if dl_id in sent_reminders:
                            continue
                            
                        due_str = row["due_at"]
                        try:
                            if 'T' in due_str:
                                due_dt = dt.datetime.fromisoformat(due_str)
                            else:
                                due_dt = dt.datetime.strptime(due_str, "%Y-%m-%d")
                            # Strip timezone info to prevent offset-naive vs offset-aware comparison crashes
                            if due_dt.tzinfo is not None:
                                due_dt = due_dt.replace(tzinfo=None)
                        except Exception:
                            continue
                            
                        # Calculate hours remaining
                        now_dt = dt.datetime.now()
                        diff = due_dt - now_dt
                        hours_remaining = diff.total_seconds() / 3600.0
                        
                        # If due in less than 24 hours and not overdue
                        if 0 < hours_remaining <= 24:
                            title = row["title"]
                            phone = row["phone_number"] or "+919999999999"
                            
                            # Standardize WhatsApp JID
                            clean_phone = "".join([c for c in phone if c.isdigit()])
                            to_jid = f"{clean_phone}@s.whatsapp.net"
                            
                            alert_msg = f"⚠️ KORA ALERT: Your deadline '{title}' is due in {int(hours_remaining)} hours! Auto-allocated study prep sessions have been scheduled in your timetable. Good luck!"
                            
                            print(f"Proactive alert: sending reminder for '{title}' to {to_jid}...")
                            # Post to WhatsApp bridge HTTP port 8002
                            res = requests.post("http://localhost:8002/send", json={
                                "to": to_jid,
                                "text": alert_msg
                            }, timeout=5)
                            if res.status_code == 200:
                                print(f"Successfully sent WhatsApp reminder for deadline '{title}'")
                                sent_reminders.add(dl_id)
                            else:
                                print(f"Failed to send WhatsApp reminder: {res.text}")
            except Exception as e:
                print(f"Error in deadline watcher check: {e}")
                
        time.sleep(1.5)
        
if __name__ == "__main__":
    main()
