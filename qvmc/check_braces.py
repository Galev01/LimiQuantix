
def check_braces(filepath):
    try:
        with open(filepath, 'r') as f:
            lines = f.readlines()
    except FileNotFoundError:
        print(f"File not found: {filepath}")
        return


    stack = []
    delims = {
        '{': '}',
        '(': ')',
        '[': ']'
    }
    
    # Ignore comments and strings
    in_string = False
    string_char = ''
    in_comment = False
    
    for i, line in enumerate(lines):
        line = line.rstrip()
        for j, char in enumerate(line):
            # Simple parser logic (flawed but better than nothing)
            if in_comment:
                continue # Single line comment ends at newline, which we handle by iterating lines
            
            if char == '/' and j + 1 < len(line) and line[j+1] == '/':
                break # Comment starts
            
            if char in '"\'':
                if not in_string:
                    in_string = True
                    string_char = char
                elif char == string_char:
                    # Check for escaped quote? Simplified
                    if j > 0 and line[j-1] == '\\':
                        pass
                    else:
                        in_string = False
                continue
                
            if in_string:
                continue
                
            if char in delims.keys():
                stack.append((char, i + 1, j + 1))
            elif char in delims.values():
                if not stack:
                    print(f"Error: Unmatched '{char}' at line {i + 1}, column {j + 1}")
                    return
                
                start_char, start_line, start_col = stack.pop()
                expected_end = delims[start_char]
                if char != expected_end:
                   print(f"Error: Mismatched delimiter '{char}' at line {i + 1}, column {j + 1}. Expected '{expected_end}' (opened at {start_line}:{start_col})")
                   return

    if stack:
        start_char, start_line, start_col = stack[-1]
        print(f"Error: Unclosed '{start_char}' at line {start_line}, column {start_col}")
        print(f"Total unclosed delimiters: {len(stack)}")
    else:
        print("All delimiters are balanced.")

check_braces(r"c:\Users\GalLe\Cursor projects\Quantix-KVM\LimiQuantix\qvmc\src-tauri\src\vnc\rfb.rs")
