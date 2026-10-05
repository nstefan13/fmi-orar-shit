import marimo

__generated_with = "0.23.9"
app = marimo.App()


@app.cell
def _():
    # Taken from 40_ai_processing.py

    from pydantic import BaseModel, Field
    from typing import Any, List, Literal, Optional, Union
    from langchain.messages import AIMessage
    import json as j
    import marimo as mo

    class Room(BaseModel):
        """
        Physical room or laboratory location in the university.
        """
        id: int = Field(description="Numerical room identifier (e.g. 415, 503).")
        type: Literal["Amf", "Lab", "Sala"] = Field(
            description="Room typology: 'Amf' (Amphitheatre), 'Lab' (Laboratory), or 'Sala' (Classroom)."
        )


    Location = Union[Literal["ONLINE"], Room]


    class Time(BaseModel):
        """
        Representation of weekday and time.
        """
        weekday: Literal["Luni", "Marti", "Miercuri", "Joi", "Vineri"]
        hour: int
        minute: int


    class Activity(BaseModel):
        """
        Semantic information extracted from an individual timetable activity crop.
        """
        id: int = Field(
            description="Sequential index identifier of the activity within the batch prompt (0, 1, 2, ...).",
        )
        name: str = Field(
            description="Name or title of the subject/activity (with extraneous type info removed).",
        )
        authors: list[str] = Field(
            description="List of professors, lecturers, or instructors teaching the activity.",
        )
        type: Optional[Literal["Curs", "Lab", "Seminar", "Conferinta"]] = Field(
            description="Didactic classification of the activity.",
        )
        location: Optional[Location] = Field(
            description="Classroom, laboratory, amphitheatre, or online platform designation.",
        )
        periodicity: Optional[Literal["even", "odd", "range"]] = Field(
            description="Recurrence frequency: 'even' (SP), 'odd' (SI), or 'range' ([sapt X-Y]).",
        )
        subgroup: Optional[int] = Field(
            description="Target student subgroup number if the activity is subgroup-specific.",
        )


    # In this pipeline, each activity cell parsed by the vision model is referred to as VisionResponse
    VisionResponse = Activity

    class VisionBatchResponse(BaseModel):
        parsed_activities: list[VisionResponse]


    #### Utilities
    def to_json(obj):
        return j.dumps(obj, default=lambda o: o.__dict__)

    def from_json(obj):
        return j.loads(obj)

    return AIMessage, Activity, Room, VisionBatchResponse, mo


@app.cell
def _(AIMessage, Activity, Room, VisionBatchResponse):
    batch=['IMG-041_AC-08.png', 'IMG-041_AC-09.png', 'IMG-041_AC-10.png', 'IMG-041_AC-11.png', 'IMG-042_AC-00.png', 'IMG-042_AC-01.png']
    resp={ 'parsed': VisionBatchResponse(parsed_activities=[Activity(id=0, name='AlgFundam', authors=[], type='Curs', location=Room(id=209, type='Sala'), periodicity='range', subgroup=0, observations=''), Activity(id=0, name='AlgFundam', authors=['Buzatu G'], type='Curs', location=Room(id=209, type='Sala'), periodicity='range', subgroup=0, observations=''), Activity(id=1, name='SistAvansBD', authors=['Vasile SL'], type='Curs', location=Room(id=512, type='Sala'), periodicity='range', subgroup=0, observations=''), Activity(id=2, name='ProgFunc', authors=['Iova A'], type='Curs', location=Room(id=106, type='Lab'), periodicity='range', subgroup=0, observations=''), Activity(id=3, name='AlgFundam', authors=['Dumitran M'], type='Curs', location=Room(id=512, type='Sala'), periodicity='range', subgroup=0, observations=''), Activity(id=4, name='StructDate&Alg', authors=['Mincu RS'], type='Curs', location=Room(id=512, type='Sala'), periodicity='range', subgroup=0, observations='')]),
      'parsing_error': None,
      'raw': AIMessage(content='{\n  "parsed_activities": [\n    {\n      "authors": [],\n      "id": 0,\n      "location": {\n        "id": 209,\n        "type": "Sala"\n      },\n      "name": "AlgFundam"\n    ,\n      "observations": ""\n    ,\n      "periodicity": "range"\n    ,\n      "subgroup": 0,\n      "type": "Curs"\n    },\n    {\n      "authors": [\n        "Buzatu G"\n      ],\n      "id": 0,\n      "location": {\n        "id": 209,\n        "type": "Sala"\n      },\n      "name": "AlgFundam"\n    ,\n      "observations": "",\n      "periodicity": "range",\n      "subgroup": 0,\n      "type": "Curs"\n    },\n    {\n      "authors": [\n        "Vasile SL"\n      ],\n      "id": 1,\n      "location": {\n        "id": 512,\n        "type": "Sala"\n      },\n      "name": "SistAvansBD"\n    ,\n      "observations": "",\n      "periodicity": "range",\n      "subgroup": 0,\n      "type": "Curs"\n    },\n    {\n      "authors": [\n        "Iova A"\n      ],\n      "id": 2,\n      "location": {\n        "id": 106,\n        "type": "Lab"\n      },\n      "name": "ProgFunc"\n    ,\n      "observations": "",\n      "periodicity": "range",\n      "subgroup": 0,\n      "type": "Curs"\n    },\n    {\n      "authors": [\n        "Dumitran M"\n      ],\n      "id": 3,\n      "location": {\n        "id": 512,\n        "type": "Sala"\n      },\n      "name": "AlgFundam"\n    ,\n      "observations": "",\n      "periodicity": "range",\n      "subgroup": 0,\n      "type": "Curs"\n    },\n    {\n      "authors": [\n        "Mincu RS"\n      ],\n      "id": 4,\n      "location": {\n        "id": 512,\n        "type": "Sala"\n      },\n      "name": "StructDate&Alg"\n    ,\n      "observations": "",\n      "periodicity": "range",\n      "subgroup": 0,\n      "type": "Curs"\n    }\n  ]\n}', additional_kwargs={'reasoning_content': 'Thinking Process:\n\n1.  **Understand the Goal**: The user wants a JSON object matching the `Response` interface containing parsed activities from 6 images (IDs 0 to 5). No markdown, no explanations, just the raw JSON.\n\n2.  **Analyze the Images one by one**:\n\n    *   **Image ID=0**:\n        *   Author (top-left): `Buzatu G`\n        *   Name (center): `AlgFundam`\n        *   Location (bottom-right): `S.209` -> room id 209, type "Sala" (since \'S\' stands for Sala).\n        *   Type: Not explicitly in name, but "AlgFundam" usually stands for "Algebra Fundamentala" or similar, likely a Curs or Lab, but no explicit type in the name like `(curs)`. Let\'s check guidelines: "If the type of an activity is not obvious or cannot be determined with high confidence, set it to undefined / do not specify it." Let\'s write `type?: undefined` (or omit it).\n        *   Let\'s check the schema for `type`: `"Curs" | "Lab" | "Seminar" | "Conferinta"`. Since it doesn\'t say `(curs)` or anything, we omit/leave undefined.\n        *   Let\'s write down the parsed values for ID 0:\n            *   `id`: 0\n            *   `name`: "AlgFundam"\n            *   `authors`: ["Buzatu G"]\n            *   `location`: { `id`: 209, `type`: "Sala" } (since "S.209" -> S = Sala, id = 209). Or is it just `location?: Location` where `Location = "ONLINE" | Room` and `Room` has `id` and `type`? Yes: `interface Room { id: number; type: "Amf" | "Lab" | "Sala"; }`. So `location: { id: 209, type: "Sala" }`.\n\n    *   **Image ID=1**:\n        *   Author (top-left): `Vasile SL`\n        *   Name (center): `SistAvansBD`\n        *   Location (bottom-right): `S-512` -> room id 512, type "Sala" (S). Note the format: "S-512" vs "S.209". Both mean Sala, id 512. Let\'s write `id: 512`, `type: "Sala"`.\n        *   Type: Not specified in name, so omit/undefined.\n        *   Let\'s write down parsed values for ID 1:\n            *   `id`: 1\n            *   `name`: "SistAvansBD"\n            *   `authors`: ["Vasile SL"]\n            *   `location`: { `id`: 512, `type`: "Sala" }\n\n    *   **Image ID=2**:\n        *   Author (top-left): `Iova A` (starts with capital I, looks like \'Iova A\' or \'lova A\'. Usually \'Iova\' is a Romanian name, starts with capital I. The prompt says: "due to image quality, you may find yourself in a situation where you interpret the letter \'I\' (upper case \'I\') as an \'l\' (lowercase \'l\'). ... replace that lowercase \'l\' with an uppercase \'I\'". Looking at the image: "Iova A" or "lova A". It looks like capital I, but let\'s write "Iova A" since \'Iova\' is a common surname, and lowercase \'l\' would be \'lova\' which is less common, and capital I makes sense). Let\'s write `Iova A`.\n        *   Name (center): `ProgFunc`\n        *   Location (bottom-right): `L-106` -> room id 106, type "Lab" (L).\n        *   Type: Omit/undefined.\n        *   Parsed values for ID 2:\n            *   `id`: 2\n            *   `name`: "ProgFunc"\n            *   `authors`: ["Iova A"]\n            *   `location`: { `id`: 106, `type`: "Lab" }\n\n    *   **Image ID=3**:\n        *   Author (top-left): `Dumitran M`\n        *   Name (center): `AlgFundam (curs)` -> name should be "AlgFundam", type is "Curs" (since it says `(curs)`).\n        *   Location (bottom-right): `S-512` -> room id 512, type "Sala".\n        *   Parsed values for ID 3:\n            *   `id`: 3\n            *   `name`: "AlgFundam"\n            *   `type`: "Curs"\n            *   `authors`: ["Dumitran M"]\n            *   `location`: { `id`: 512, `type`: "Sala" }\n\n    *   **Image ID=4**:\n        *   Author (top-left): `Mincu RS`\n        *   Name (center): `StructDate&Alg (curs)` -> name should be "StructDate&Alg", type is "Curs" (since it says `(curs)`). Let\'s write name as "StructDate&Alg".\n        *   Location (bottom-right): `S-512` -> room id 512, type "Sala".\n        *   Parsed values for ID 4:\n            *   `id`: 4\n            *   `name`: "StructDate&Alg"\n            *   `type`: "Curs"\n            *   `authors`: ["Mincu RS"]\n            *   `location`: { `id`: 512, `type`: "Sala" }\n\n    *   **Image ID=5**:\n        *   Author (top-left): `Dragulici D`\n        *   Name (center): `SistOper`\n        *   Location (bottom-right): `S-512` -> room id 512, type "Sala".\n        *   Type: Omit/undefined.\n        *   Parsed values for ID 5:\n            *   `id`: 5\n            *   `name`: "SistOper"\n            *   `authors`: ["Dragulici D"]\n            *   `location`: { `id`: 512, `type`: "Sala" }\n\n3.  **Review the schema constraints**:\n    *   `id`: number\n    *   `name`: string\n    *   `type?`: "Curs" | "Lab" | "Seminar" | "Conferinta"\n    *   `authors`: string[]\n    *   `location?`: Location ("ONLINE" | Room) -> Room is `{ id: number; type: "Amf" | "Lab" | "Sala"; }`\n    *   `periodicity?`: "even" | "odd" | "range" (none of these images seem to have periodicity text, so omit)\n    *   `subgroup?`: number (none seem to have SG or Gr_ subgroup indicators, so omit)\n    *   `observations?`: string (only if new location type or other notes, none here).\n\nLet\'s double check the authors spelling and names:\n*   ID 0: "Buzatu G" -> `authors: ["Buzatu G"]`\n*   ID 1: "Vasile SL" -> `authors: ["Vasile SL"]`\n*   ID 2: "Iova A" -> `authors: ["Iova A"]` (capital I). Let me write "Iova A" but check if the visual looks like capital I or lowercase l. The font is sans-serif. A capital \'I\' in standard sans-serif is a straight vertical line, sometimes with small serifs at top/bottom, but often just a vertical bar. A lowercase \'l\' is also a vertical bar, sometimes with a small curve or just a straight bar. In standard Arial, capital \'I\' has horizontal bars at top and bottom if it\'s serif, but in Arial sans-serif, capital \'I\' is just a vertical line, and lowercase \'l\' is also a vertical line but slightly shorter, or identical. However, "Iova" starts with capital I, which is standard for Romanian names (e.g., Iova). So write "Iova A".\n*   ID 3: "Dumitran M" -> `authors: ["Dumitran M"]`\n*   ID 4: "Mincu RS" -> `authors: ["Mincu RS"]`\n*   ID 5: "Dragulici D" -> `authors: ["Dragulici D"]`\n\nLet\'s double check the names:\n*   ID 0: "AlgFundam"\n*   ID 1: "SistAvansBD"\n*   ID 2: "ProgFunc"\n*   ID 3: "AlgFundam" (from "AlgFundam (curs)")\n*   ID 4: "StructDate&Alg" (from "StructDate&Alg (curs)")\n*   ID 5: "SistOper"\n\nLet\'s double check the locations:\n*   ID 0: "S.209" -> `location: { id: 209, type: "Sala" }`\n*   ID 1: "S-512" -> `location: { id: 512, type: "Sala" }`\n*   ID 2: "L-106" -> `location: { id: 106, type: "Lab" }`\n*   ID 3: "S-512" -> `location: { id: 512, type: "Sala" }`\n*   ID 4: "S-512" -> `location: { id: 512, type: "Sala" }`\n*   ID 5: "S-512" -> `location: { id: 512, type: "Sala" }`\n\nAre there any other fields?\n*   `periodicity`: none of the images show any week indicators like "SP", "SI", "impar", "para", or "[sapt 9-15]". So omit.\n*   `subgroup`: none show "SG" or "Gr_". So omit.\n*   `observations`: none needed unless we want to put something, but standard is to omit if empty.\n\nLet\'s write the JSON structure:\n```json\n{\n  "parsed_activities": [\n    {\n      "id": 0,\n      "name": "AlgFundam",\n      "authors": ["Buzatu G"],\n      "location": {\n        "id": 209,\n        "type": "Sala"\n      }\n    },\n    {\n      "id": 1,\n      "name": "SistAvansBD",\n      "authors": ["Vasile SL"],\n      "location": {\n        "id": 512,\n        "type": "Sala"\n      }\n    },\n    {\n      "id": 2,\n      "name": "ProgFunc",\n      "authors": ["Iova A"],\n      "location": {\n        "id": 106,\n        "type": "Lab"\n      }\n    },\n    {\n      "id": 3,\n      "name": "AlgFundam",\n      "type": "Curs",\n      "authors": ["Dumitran M"],\n      "location": {\n        "id": 512,\n        "type": "Sala"\n      }\n    },\n    {\n      "id": 4,\n      "name": "StructDate&Alg",\n      "type": "Curs",\n      "authors": ["Mincu RS"],\n      "location": {\n        "id": 512,\n        "type": "Sala"\n      }\n    },\n    {\n      "id": 5,\n      "name": "SistOper",\n      "authors": ["Dragulici D"],\n      "location": {\n        "id": 512,\n        "type": "Sala"\n      }\n    }\n  ]\n}\n```\n\nLet me review the name of ID 4: "StructDate&Alg (curs)" -> name should be "StructDate&Alg". Is it "StructDate&Alg" or "StructDate si Alg"? Looking closely at image 4: "StructDate&Alg (curs)". Yes, the ampersand \'&\' is clearly visible, and no spaces around it. So "StructDate&Alg".\nLet me review the name of ID 1: "SistAvansBD". Yes.\nLet me review the name of ID 2: "ProgFunc". Yes.\nLet me review the name of ID 5: "SistOper". Yes.\n\nLet me check the spelling of authors:\n- "Buzatu G"\n- "Vasile SL"\n- "Iova A" (capital I, written as "Iova A")\n- "Dumitran M"\n- "Mincu RS"\n- "Dragulici D"\n\nEverything looks extremely straightforward and matches the schema perfectly.\nNo other fields like periodicity, subgroup, or observations are present in these images, so they should be omitted.\n\nLet\'s write the output as raw JSON, no formatting outside the JSON block if possible, but the prompt says: "The answer must be ONLY a valid JSON object matching the Response interface, without any markdown formatting, preambles, or explanations outside the JSON". So just output the JSON code.\n', 'reasoning_details': [{'type': 'reasoning.text', 'format': 'unknown', 'index': 0, 'text': 'Thinking Process:\n\n1.  **Understand the Goal**: The user wants a JSON object matching the `Response` interface containing parsed activities from 6 images (IDs 0 to 5). No markdown, no explanations, just the raw JSON.\n\n2.  **Analyze the Images one by one**:\n\n    *   **Image ID=0**:\n        *   Author (top-left): `Buzatu G`\n        *   Name (center): `AlgFundam`\n        *   Location (bottom-right): `S.209` -> room id 209, type "Sala" (since \'S\' stands for Sala).\n        *   Type: Not explicitly in name, but "AlgFundam" usually stands for "Algebra Fundamentala" or similar, likely a Curs or Lab, but no explicit type in the name like `(curs)`. Let\'s check guidelines: "If the type of an activity is not obvious or cannot be determined with high confidence, set it to undefined / do not specify it." Let\'s write `type?: undefined` (or omit it).\n        *   Let\'s check the schema for `type`: `"Curs" | "Lab" | "Seminar" | "Conferinta"`. Since it doesn\'t say `(curs)` or anything, we omit/leave undefined.\n        *   Let\'s write down the parsed values for ID 0:\n            *   `id`: 0\n            *   `name`: "AlgFundam"\n            *   `authors`: ["Buzatu G"]\n            *   `location`: { `id`: 209, `type`: "Sala" } (since "S.209" -> S = Sala, id = 209). Or is it just `location?: Location` where `Location = "ONLINE" | Room` and `Room` has `id` and `type`? Yes: `interface Room { id: number; type: "Amf" | "Lab" | "Sala"; }`. So `location: { id: 209, type: "Sala" }`.\n\n    *   **Image ID=1**:\n        *   Author (top-left): `Vasile SL`\n        *   Name (center): `SistAvansBD`\n        *   Location (bottom-right): `S-512` -> room id 512, type "Sala" (S). Note the format: "S-512" vs "S.209". Both mean Sala, id 512. Let\'s write `id: 512`, `type: "Sala"`.\n        *   Type: Not specified in name, so omit/undefined.\n        *   Let\'s write down parsed values for ID 1:\n            *   `id`: 1\n            *   `name`: "SistAvansBD"\n            *   `authors`: ["Vasile SL"]\n            *   `location`: { `id`: 512, `type`: "Sala" }\n\n    *   **Image ID=2**:\n        *   Author (top-left): `Iova A` (starts with capital I, looks like \'Iova A\' or \'lova A\'. Usually \'Iova\' is a Romanian name, starts with capital I. The prompt says: "due to image quality, you may find yourself in a situation where you interpret the letter \'I\' (upper case \'I\') as an \'l\' (lowercase \'l\'). ... replace that lowercase \'l\' with an uppercase \'I\'". Looking at the image: "Iova A" or "lova A". It looks like capital I, but let\'s write "Iova A" since \'Iova\' is a common surname, and lowercase \'l\' would be \'lova\' which is less common, and capital I makes sense). Let\'s write `Iova A`.\n        *   Name (center): `ProgFunc`\n        *   Location (bottom-right): `L-106` -> room id 106, type "Lab" (L).\n        *   Type: Omit/undefined.\n        *   Parsed values for ID 2:\n            *   `id`: 2\n            *   `name`: "ProgFunc"\n            *   `authors`: ["Iova A"]\n            *   `location`: { `id`: 106, `type`: "Lab" }\n\n    *   **Image ID=3**:\n        *   Author (top-left): `Dumitran M`\n        *   Name (center): `AlgFundam (curs)` -> name should be "AlgFundam", type is "Curs" (since it says `(curs)`).\n        *   Location (bottom-right): `S-512` -> room id 512, type "Sala".\n        *   Parsed values for ID 3:\n            *   `id`: 3\n            *   `name`: "AlgFundam"\n            *   `type`: "Curs"\n            *   `authors`: ["Dumitran M"]\n            *   `location`: { `id`: 512, `type`: "Sala" }\n\n    *   **Image ID=4**:\n        *   Author (top-left): `Mincu RS`\n        *   Name (center): `StructDate&Alg (curs)` -> name should be "StructDate&Alg", type is "Curs" (since it says `(curs)`). Let\'s write name as "StructDate&Alg".\n        *   Location (bottom-right): `S-512` -> room id 512, type "Sala".\n        *   Parsed values for ID 4:\n            *   `id`: 4\n            *   `name`: "StructDate&Alg"\n            *   `type`: "Curs"\n            *   `authors`: ["Mincu RS"]\n            *   `location`: { `id`: 512, `type`: "Sala" }\n\n    *   **Image ID=5**:\n        *   Author (top-left): `Dragulici D`\n        *   Name (center): `SistOper`\n        *   Location (bottom-right): `S-512` -> room id 512, type "Sala".\n        *   Type: Omit/undefined.\n        *   Parsed values for ID 5:\n            *   `id`: 5\n            *   `name`: "SistOper"\n            *   `authors`: ["Dragulici D"]\n            *   `location`: { `id`: 512, `type`: "Sala" }\n\n3.  **Review the schema constraints**:\n    *   `id`: number\n    *   `name`: string\n    *   `type?`: "Curs" | "Lab" | "Seminar" | "Conferinta"\n    *   `authors`: string[]\n    *   `location?`: Location ("ONLINE" | Room) -> Room is `{ id: number; type: "Amf" | "Lab" | "Sala"; }`\n    *   `periodicity?`: "even" | "odd" | "range" (none of these images seem to have periodicity text, so omit)\n    *   `subgroup?`: number (none seem to have SG or Gr_ subgroup indicators, so omit)\n    *   `observations?`: string (only if new location type or other notes, none here).\n\nLet\'s double check the authors spelling and names:\n*   ID 0: "Buzatu G" -> `authors: ["Buzatu G"]`\n*   ID 1: "Vasile SL" -> `authors: ["Vasile SL"]`\n*   ID 2: "Iova A" -> `authors: ["Iova A"]` (capital I). Let me write "Iova A" but check if the visual looks like capital I or lowercase l. The font is sans-serif. A capital \'I\' in standard sans-serif is a straight vertical line, sometimes with small serifs at top/bottom, but often just a vertical bar. A lowercase \'l\' is also a vertical bar, sometimes with a small curve or just a straight bar. In standard Arial, capital \'I\' has horizontal bars at top and bottom if it\'s serif, but in Arial sans-serif, capital \'I\' is just a vertical line, and lowercase \'l\' is also a vertical line but slightly shorter, or identical. However, "Iova" starts with capital I, which is standard for Romanian names (e.g., Iova). So write "Iova A".\n*   ID 3: "Dumitran M" -> `authors: ["Dumitran M"]`\n*   ID 4: "Mincu RS" -> `authors: ["Mincu RS"]`\n*   ID 5: "Dragulici D" -> `authors: ["Dragulici D"]`\n\nLet\'s double check the names:\n*   ID 0: "AlgFundam"\n*   ID 1: "SistAvansBD"\n*   ID 2: "ProgFunc"\n*   ID 3: "AlgFundam" (from "AlgFundam (curs)")\n*   ID 4: "StructDate&Alg" (from "StructDate&Alg (curs)")\n*   ID 5: "SistOper"\n\nLet\'s double check the locations:\n*   ID 0: "S.209" -> `location: { id: 209, type: "Sala" }`\n*   ID 1: "S-512" -> `location: { id: 512, type: "Sala" }`\n*   ID 2: "L-106" -> `location: { id: 106, type: "Lab" }`\n*   ID 3: "S-512" -> `location: { id: 512, type: "Sala" }`\n*   ID 4: "S-512" -> `location: { id: 512, type: "Sala" }`\n*   ID 5: "S-512" -> `location: { id: 512, type: "Sala" }`\n\nAre there any other fields?\n*   `periodicity`: none of the images show any week indicators like "SP", "SI", "impar", "para", or "[sapt 9-15]". So omit.\n*   `subgroup`: none show "SG" or "Gr_". So omit.\n*   `observations`: none needed unless we want to put something, but standard is to omit if empty.\n\nLet\'s write the JSON structure:\n```json\n{\n  "parsed_activities": [\n    {\n      "id": 0,\n      "name": "AlgFundam",\n      "authors": ["Buzatu G"],\n      "location": {\n        "id": 209,\n        "type": "Sala"\n      }\n    },\n    {\n      "id": 1,\n      "name": "SistAvansBD",\n      "authors": ["Vasile SL"],\n      "location": {\n        "id": 512,\n        "type": "Sala"\n      }\n    },\n    {\n      "id": 2,\n      "name": "ProgFunc",\n      "authors": ["Iova A"],\n      "location": {\n        "id": 106,\n        "type": "Lab"\n      }\n    },\n    {\n      "id": 3,\n      "name": "AlgFundam",\n      "type": "Curs",\n      "authors": ["Dumitran M"],\n      "location": {\n        "id": 512,\n        "type": "Sala"\n      }\n    },\n    {\n      "id": 4,\n      "name": "StructDate&Alg",\n      "type": "Curs",\n      "authors": ["Mincu RS"],\n      "location": {\n        "id": 512,\n        "type": "Sala"\n      }\n    },\n    {\n      "id": 5,\n      "name": "SistOper",\n      "authors": ["Dragulici D"],\n      "location": {\n        "id": 512,\n        "type": "Sala"\n      }\n    }\n  ]\n}\n```\n\nLet me review the name of ID 4: "StructDate&Alg (curs)" -> name should be "StructDate&Alg". Is it "StructDate&Alg" or "StructDate si Alg"? Looking closely at image 4: "StructDate&Alg (curs)". Yes, the ampersand \'&\' is clearly visible, and no spaces around it. So "StructDate&Alg".\nLet me review the name of ID 1: "SistAvansBD". Yes.\nLet me review the name of ID 2: "ProgFunc". Yes.\nLet me review the name of ID 5: "SistOper". Yes.\n\nLet me check the spelling of authors:\n- "Buzatu G"\n- "Vasile SL"\n- "Iova A" (capital I, written as "Iova A")\n- "Dumitran M"\n- "Mincu RS"\n- "Dragulici D"\n\nEverything looks extremely straightforward and matches the schema perfectly.\nNo other fields like periodicity, subgroup, or observations are present in these images, so they should be omitted.\n\nLet\'s write the output as raw JSON, no formatting outside the JSON block if possible, but the prompt says: "The answer must be ONLY a valid JSON object matching the Response interface, without any markdown formatting, preambles, or explanations outside the JSON". So just output the JSON code.\n'}]}, response_metadata={'model_name': 'dots-studio/dots-3-note-preview:free', 'id': 'gen-1791180270-UyXeIvSnBp4mL4XrlmEW', 'created': 1791180270, 'object': 'chat.completion', 'finish_reason': 'stop', 'logprobs': None, 'model_provider': 'openrouter', 'cost': 0.0, 'cost_details': {'upstream_inference_completions_cost': 0.0, 'upstream_inference_prompt_cost': 0.0, 'upstream_inference_cost': 0.0}}, id='lc_run--01a10aa9-e593-7211-a6c8-67df12b441e9-0', tool_calls=[], invalid_tool_calls=[], usage_metadata={'input_tokens': 2307, 'output_tokens': 3525, 'total_tokens': 5832, 'input_token_details': {'cache_read': 1536, 'cache_creation': 0}, 'output_token_details': {'reasoning': 2321}})}

    return batch, resp


@app.cell
def _(batch, mo):
    from pathlib import Path

    image_name2path = batch[:]
    for index, image_name in enumerate(batch):
        image_name2path[index] = str(Path(f'../output/preprocessed-activities/images/{image_name}').absolute())

    image_in_batch_slider = mo.ui.slider(start=0, stop=len(batch) - 1, step=1)
    return Path, image_in_batch_slider, image_name2path


@app.cell
def _(mo, resp):
    mo.md(resp['raw'].additional_kwargs['reasoning_content']).style(
        max_height="300px",
        overflow_y="auto"
    )

    resp
    return


@app.cell
def _(Path, image_in_batch_slider, image_name2path, mo):
    correct = {
      "parsed_activities": [
        {
          "id": 0,
          "name": "AlgFundam",
          "authors": ["Buzatu G"],
          "location": {
            "id": 209,
            "type": "Sala"
          }
        },
        {
          "id": 1,
          "name": "SistAvansBD",
          "authors": ["Vasile SL"],
          "location": {
            "id": 512,
            "type": "Sala"
          }
        },
        {
          "id": 2,
          "name": "ProgFunc",
          "authors": ["Iova A"],
          "location": {
            "id": 106,
            "type": "Lab"
          }
        },
        {
          "id": 3,
          "name": "AlgFundam",
          "type": "Curs",
          "authors": ["Dumitran M"],
          "location": {
            "id": 512,
            "type": "Sala"
          }
        },
        {
          "id": 4,
          "name": "StructDate&Alg",
          "type": "Curs",
          "authors": ["Mincu RS"],
          "location": {
            "id": 512,
            "type": "Sala"
          }
        },
        {
          "id": 5,
          "name": "SistOper",
          "authors": ["Dragulici D"],
          "location": {
            "id": 512,
            "type": "Sala"
          }
        }
      ]
    }


    mo.hstack([
        mo.vstack([
            mo.image( Path(image_name2path[int(image_in_batch_slider.value)]).read_bytes(), width=500 ),
            mo.md(f"""
    **Path**:  {image_name2path[int(image_in_batch_slider.value)]}

    **Index**: {image_in_batch_slider.value}
    """),
            image_in_batch_slider,
        ]),
        mo.json(correct),
        "start",
    ])
    return


if __name__ == "__main__":
    app.run()
