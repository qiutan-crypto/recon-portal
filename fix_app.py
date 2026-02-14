
import os
filename = r'c:/Users/Lifeng Liu/OneDrive/文档/Python Script/Customer Questionaire/recon-portal/src/App.jsx'
with open(filename, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Indicies are 0-based. Line 631 is index 630. Line 731 is index 730.
start_idx = 630
end_idx = 730 # inclusive deletion

# Verify content to be sure
print(f"Line {start_idx+1}: {lines[start_idx].strip()}")
print(f"Line {end_idx+1}: {lines[end_idx].strip()}")

if "space-y-6" not in lines[start_idx]:
    print("Error: Start line content mismatch. Aborting.")
    exit(1)

# Remove lines from start_idx to end_idx inclusive
# Slice removal: keep lines[:start_idx] + lines[end_idx+1:]
new_lines = lines[:start_idx] + lines[end_idx+1:]

with open(filename, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Successfully removed duplicate block.")
