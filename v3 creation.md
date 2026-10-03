V1
===

1. COLUMN HEADERS & INTERVAL FORMAT:
   - Each column represents a 1-hour slot labeled with the starting hour and interval (e.g., "16" with "16:00 - 16:50").
   - A single-column activity starts at `<col>:00` and ends at `<col>:50`.
   - A multi-column activity starts at `<start_col>:00` and ends at `<end_col>:50` of its rightmost column.

2. DURATION & RED GUIDELINES (MANDATORY ALGORITHM):
   - Red vertical guidelines mark the exact boundaries between hour columns.
   - For EVERY activity box, determine duration by counting the internal red guidelines crossed (excluding the outer left and right border lines):
      * 0 internal red lines = 1 column (1 hour duration). Start col == End col.
      * 1 internal red line = 2 columns (2 hour duration). End col = Start col + 1.
      * 2 internal red lines = 3 columns (3 hour duration). End col = Start col + 2.
   - RULE: Most lab and course activities span across 2 columns (1 internal red guideline).

3. SPLIT-CELL LAYOUT RECOGNITION:
   - University timetable cards that span 2 columns frequently place the Course Name and Teacher on the left column, and the Group (e.g., "Gr_1") and Room (e.g., "L-202") on the right column.
   - Do NOT assume a card ends where the course name ends. Trace the enclosing outer border across the red guideline into the adjacent column.
   - Vertical splits (subgroups/periodicities) only affect vertical height. They do NOT reduce horizontal duration; if the box crosses a vertical red line, it spans the full 2 hours.

4. MANDATORY CHAIN-OF-THOUGHT FOR EACH ACTIVITY:
   Before generating JSON for an activity, you must state:
   - "Activity: [Name]"
   - "Start Column Header: [X] -> Start Time: [X:00]"
   - "Internal red guidelines crossed: [N]"
   - "End Column Header: [X + N] -> End Time: [X + N:50]"
   
   






V2
===
1. ACADEMIC DURATION DEFAULT:
   - Most activities (Curs, Lab, Seminar) last 2 academic hours (spanning 2 adjacent columns).
   - A 1-hour or 3-hour activity (single column) is rare and must be verified by confirming its width equals exactly one header cell.

2. HORIZONTAL LAYOUT ANCHORS (LEFT VS. RIGHT HALF):
   - A 2-hour activity card is horizontally divided into two halves:
     * Left half (Hour 1): Course Name and Teacher Name.
     * Right half (Hour 2): Subgroup (e.g., "Gr_1", "Gr_3") and Room ID (e.g., "L-202", "L-509").
   - IF a card contains the Group/Room on its right side, it spans across TWO full columns.
     * Start Column: The column directly above the Course Name (e.g., Column 16 -> 16:00).
     * End Column: The column directly above the Group/Room (e.g., Column 17 -> 17:50).

3. BOUNDARY TRACING VIA HEADER ALIGNMENT (DO NOT RELY ON INTERNAL LINES):
   - Do NOT attempt to detect faint red lines inside colored boxes.
   - Trace the LEFT edge of the colored card straight up to the top header row to get <start_col>.
   - Trace the RIGHT edge of the colored card straight up to the top header row to get <end_col>.
   - Calculate:
     * Start Time = <start_col>:00
     * End Time = <end_col>:50

4. MANDATORY CHAIN-OF-THOUGHT FOR EACH ACTIVITY:
   Before generating JSON for an activity, you must state:
   - "Activity: [Name]"
   - "Left edge header (Course Name column): [Col A] -> Start Time: [Col A]:00"
   - "Right edge header (Group/Room column): [Col B] -> End Time: [Col B]:50"
   - "Duration: [Col B - Col A + 1] hour(s)"
   




V3 (with insights from V1 and V2)
===

1. COLUMN HEADERS & INTERVAL FORMAT:
   - Each column represents a 1-hour slot labeled with the starting hour and interval (e.g., "16" with "16:00 - 16:50").
   - A single-column activity starts at `<col>:00` and ends at `<col>:50`.
   - A multi-column activity starts at `<start_col>:00` and ends at `<end_col>:50` of its rightmost column.

2. DURATION & RED GUIDELINES (MANDATORY ALGORITHM):
   - Red vertical guidelines mark the exact boundaries between hour columns.
   - For EVERY activity box, determine duration by counting the internal red guidelines crossed (excluding the outer left and right border lines):
      * 0 internal red lines = 1 column (1 hour duration). Start col == End col.
      * 1 internal red line = 2 columns (2 hour duration). End col = Start col + 1.
      * 2 internal red lines = 3 columns (3 hour duration). End col = Start col + 2.
   - RULE: Most lab and course activities span across 2 columns (1 internal red guideline).

3. SPLIT-CELL LAYOUT RECOGNITION:
   - Do NOT attempt to detect faint red lines inside colored boxes.
   - Trace the LEFT edge of the colored card straight up to the top header row to get <start_col>.
   - Trace the RIGHT edge of the colored card straight up to the top header row to get <end_col>.
   - Calculate:
     * Start Time = <start_col>:00
     * End Time = <end_col>:50
   - University timetable cards that span 2 columns frequently place the Course Name and Teacher on the left column, and the Group (e.g., "Gr_1") and Room (e.g., "L-202") on the right column.
   - Do NOT assume a card ends where the course name ends. Trace the enclosing outer border across the red guideline into the adjacent column.
   - Vertical splits (subgroups/periodicities) only affect vertical height. They do NOT reduce horizontal duration; if the box crosses a vertical red line, it spans the full 2 hours.

4. MANDATORY CHAIN-OF-THOUGHT FOR EACH ACTIVITY:
   Before generating JSON for an activity, you must state:
   - "Activity: [Name]"
   - "Start Column Header: [X] -> Start Time: [X:00]"
   - "Internal red guidelines crossed: [N]"
   - "End Column Header: [X + N] -> End Time: [X + N:50]"