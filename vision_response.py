from typing import List, Literal, Optional, Union
from pydantic import BaseModel, Field


class Room(BaseModel):
    id: int
    type: Literal["Amf", "Lab", "Sala"]


Location = Union[Literal["ONLINE"], Room]


class Time(BaseModel):
    weekday: Literal["Lu", "Ma", "Mi", "Jo", "Vi"]
    hour: int
    minute: int


# An entry in the timetable representing a course, lab etc
class Activity(BaseModel):
    start: Time
    end: Time
    name: str
    type: Optional[Literal["Curs", "Lab", "Seminar", "Conferinta"]] = None
    authors: List[str]
    location: Optional[Location] = None
    periodicity: Optional[Literal["even", "odd"]] = None
    subgroup: Optional[int] = None
    observations: Optional[str] = None


class VisionResponse(BaseModel):
    activities: list[Activity] = Field(
        description="A list of entries in the timetable representing conferences, labs, etc.",
    )
