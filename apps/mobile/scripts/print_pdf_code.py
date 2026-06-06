import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r'c:\Users\dell\Desktop\kora\apps\mobile\src\app\index.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if any(term in line.lower() for term in ["pdf", "circular", "allocate", "proactive"]):
        print(f"Line {idx+1}: {line.strip()}")
