with open(r'c:\Users\dell\Desktop\kora\apps\mobile\src\app\index.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

terms = ["proactive", "allocate", "voice", "ingest/pdf", "Circular", "pdf"]
for term in terms:
    count = code.lower().count(term.lower())
    print(f"Term '{term}': {count} occurrences")
