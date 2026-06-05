with open('apps/backend/main.py', 'rb') as f:
    content = f.read()

# The file might be UTF-16 or have mixed content.
# Let's search for the last occurrence of the known good string in various encodings or just as bytes.
# 'return {"reply": "NONE"}'
target = b'return {"reply": "NONE"}'

idx = content.rfind(target)
if idx != -1:
    # We found it. Now let's keep everything up to this point + some newlines.
    # We also want to make sure we don't include any trailing nulls if it was UTF-16.
    # But since we found the exact bytes, content[:idx+len(target)] should be fine.
    new_content = content[:idx + len(target)]
    with open('apps/backend/main.py', 'wb') as f:
        f.write(new_content)
        f.write(b'\n')
    print(f"Fixed file at index {idx}")
else:
    # Try searching for it with nulls (UTF-16 LE)
    target_u16 = 'return {"reply": "NONE"}'.encode('utf-16le')
    idx = content.rfind(target_u16)
    if idx != -1:
        new_content = content[:idx].replace(b'\x00', b'') # This is risky but let's see
        # Actually if it's all UTF-16, we should decode it.
        # But it's likely mixed because I used '>>'.
        print(f"Found UTF-16 target at {idx}")
        # Let's just truncate at the first null byte we find after a reasonable point.
        # Or better: just use the part of the file we know is good.
    else:
        print("Target not found")
