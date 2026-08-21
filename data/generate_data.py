#!/usr/bin/env python3
"""
Synthetic data generator for NYC 311 Crew Dispatch.

Produces the CSVs that get uploaded as Foundry datasets:
  incidents.csv     - seeded operational state (open / assigned / resolved)
  crews.csv         - field crews with capability, location, shift, workload
  assignments.csv   - active + historical crew-incident assignments
  capabilities.csv  - reference table of crew capabilities

Plus raw (unclassified) citizen requests used to drive the live demo:
  scenario1_new_request.csv    - Atlantic Ave pothole  -> AIP classify -> dispatch
  scenario2_storm_requests.csv - 5 simultaneous storm reports -> reprioritization
  scenario3_duplicate_request.csv - second report of the Flatbush Ave tree -> duplicate

Content is deterministic (fixed seed). Timestamps are relative to run time,
so regenerate right before a demo to make the queue look live.

Run:  python3 generate_data.py [--out DIR]
"""

import argparse
import csv
import math
import random
from datetime import datetime, timedelta
from pathlib import Path

SEED = 311
NOW = datetime.now().astimezone().replace(microsecond=0)

# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

CAPABILITIES = [
    # capability_id, name, description, typical_crew_size
    ("TREE_REMOVAL", "Tree Removal", "Chainsaw/chipper crews for downed trees and large limbs", 4),
    ("ROAD_REPAIR", "Road Repair", "Asphalt and concrete crews for potholes and pavement hazards", 3),
    ("ELECTRICAL", "Electrical", "Streetlight, traffic-signal and municipal electrical work", 2),
    ("DRAINAGE", "Drainage", "Sewer and storm-drain crews for flooding and blocked drains", 3),
    ("GENERAL_MAINTENANCE", "General Maintenance", "Graffiti removal, debris clearing, minor repairs", 2),
    ("SIGNAGE", "Signage", "Street and traffic sign repair and replacement", 2),
]

# incident_type -> (required_capability, default severity, default duration min)
INCIDENT_TYPES = {
    "FALLEN_TREE": ("TREE_REMOVAL", "HIGH", 90),
    "POTHOLE": ("ROAD_REPAIR", "MEDIUM", 45),
    "STREETLIGHT_OUT": ("ELECTRICAL", "LOW", 30),
    "TRAFFIC_SIGNAL": ("ELECTRICAL", "HIGH", 60),
    "GRAFFITI": ("GENERAL_MAINTENANCE", "LOW", 40),
    "FLOODING": ("DRAINAGE", "HIGH", 120),
    "SIDEWALK_HAZARD": ("ROAD_REPAIR", "MEDIUM", 60),
    "ROAD_OBSTRUCTION": ("GENERAL_MAINTENANCE", "MEDIUM", 30),
    "DAMAGED_SIGN": ("SIGNAGE", "LOW", 25),
}

SEVERITY_BASE = {"CRITICAL": 70, "HIGH": 50, "MEDIUM": 32, "LOW": 15}

# Anchor points for resolved-history filler (real NYC locations, approximate)
BOROUGH_ANCHORS = {
    "Brooklyn": (40.6782, -73.9442),
    "Manhattan": (40.7549, -73.9840),
    "Queens": (40.7282, -73.8448),
    "Bronx": (40.8448, -73.8648),
    "Staten Island": (40.5795, -74.1502),
}


def minutes_ago(m):
    return (NOW - timedelta(minutes=m)).isoformat()


def priority_score(severity, road_obstruction, safety_risk, minutes_open):
    """Deterministic priority. MUST stay in sync with functions/src/dispatch/priority.ts."""
    score = SEVERITY_BASE[severity]
    if road_obstruction:
        score += 12
    if safety_risk:
        score += 10
    score += min(8.0, minutes_open * 0.1)  # slow aging bonus so old work isn't starved
    return round(min(score, 100))


# ---------------------------------------------------------------------------
# Crews (8) - engineered for the demo narrative
# ---------------------------------------------------------------------------
# Demo hooks:
#   Bravo  - overloaded (3 queued/active jobs)
#   Delta  - 0.4 mi from the Flatbush tree but WRONG capability
#   Echo   - right capability for trees but OFF SHIFT (night crew)
#   Golf   - the available road crew that should win scenario 1

CREWS = [
    # crew_id, name, capability, lat, lon, borough, status, workload, max, shift_start, shift_end, vehicle
    ("CRW-A", "Crew Alpha", "TREE_REMOVAL", 40.6602, -73.9690, "Brooklyn", "AVAILABLE", 0, 4, "06:00", "22:00", "Bucket Truck 12"),
    ("CRW-B", "Crew Bravo", "ROAD_REPAIR", 40.7420, -73.9760, "Manhattan", "ON_JOB", 3, 4, "06:00", "22:00", "Asphalt Truck 7"),
    ("CRW-C", "Crew Charlie", "ELECTRICAL", 40.7440, -73.9280, "Queens", "AVAILABLE", 0, 4, "06:00", "22:00", "Utility Van 3"),
    ("CRW-D", "Crew Delta", "GENERAL_MAINTENANCE", 40.6820, -73.9740, "Brooklyn", "AVAILABLE", 0, 4, "06:00", "22:00", "Flatbed 9"),
    ("CRW-E", "Crew Echo", "TREE_REMOVAL", 40.8501, -73.8662, "Bronx", "OFF_SHIFT", 0, 4, "22:00", "06:00", "Bucket Truck 15"),
    ("CRW-F", "Crew Foxtrot", "DRAINAGE", 40.7460, -73.8910, "Queens", "ON_JOB", 1, 4, "06:00", "22:00", "Vactor Truck 2"),
    ("CRW-G", "Crew Golf", "ROAD_REPAIR", 40.6780, -73.9440, "Brooklyn", "AVAILABLE", 0, 4, "06:00", "22:00", "Asphalt Truck 11"),
    ("CRW-H", "Crew Hotel", "SIGNAGE", 40.6080, -74.1180, "Staten Island", "AVAILABLE", 0, 4, "06:00", "22:00", "Utility Van 8"),
]

# ---------------------------------------------------------------------------
# Incidents - engineered open queue + busy-crew work + resolved history
# ---------------------------------------------------------------------------
# tuple: (id, type, severity, mins_ago, lat, lon, address, borough,
#         road_obstruction, safety_risk, description)

OPEN_INCIDENTS = [
    # The headline critical incident (scenario 3 later delivers its duplicate)
    ("INC-1001", "FALLEN_TREE", "CRITICAL", 4, 40.6776, -73.9722,
     "Flatbush Ave & 7th Ave", "Brooklyn", True, True,
     "Huge tree came down on Flatbush Ave near the intersection with 7th Ave. "
     "It's blocking one lane completely and cars are swerving around it."),
    ("INC-1002", "FLOODING", "HIGH", 11, 40.7297, -73.8619,
     "Queens Blvd & 63rd Dr", "Queens", True, False,
     "Water pooling across two lanes on Queens Blvd near 63rd Drive after this "
     "morning's rain. The storm drain looks completely clogged and traffic is backing up."),
    ("INC-1003", "POTHOLE", "MEDIUM", 28, 40.7453, -73.9977,
     "W 23rd St & 8th Ave", "Manhattan", False, False,
     "Deep pothole on W 23rd St right before the 8th Ave crosswalk. My car "
     "bottomed out driving over it this morning."),
    ("INC-1004", "STREETLIGHT_OUT", "LOW", 120, 40.7180, -73.9570,
     "Bedford Ave & N 7th St", "Brooklyn", False, False,
     "Streetlight has been out for two nights on Bedford near N 7th. "
     "The corner is really dark after sunset."),
    # Seeded near-duplicate pair (same wall, two reports ~30 min apart)
    ("INC-1005", "GRAFFITI", "LOW", 300, 40.7644, -73.9235,
     "Astoria Blvd & 31st St", "Queens", False, False,
     "Fresh spray-paint tags covering the wall under the elevated tracks at "
     "Astoria Blvd and 31st St."),
    ("INC-1006", "GRAFFITI", "LOW", 270, 40.7648, -73.9230,
     "Astoria Blvd & 31st St", "Queens", False, False,
     "Someone tagged the whole underpass wall by the Astoria Blvd station. "
     "Looks like it happened overnight."),
    ("INC-1007", "SIDEWALK_HAZARD", "MEDIUM", 180, 40.8270, -73.9230,
     "Grand Concourse & E 170th St", "Bronx", False, True,
     "Sidewalk slabs are heaved up about four inches outside the pharmacy on "
     "Grand Concourse. An older man tripped there yesterday."),
    ("INC-1008", "DAMAGED_SIGN", "LOW", 480, 40.5900, -74.1000,
     "Hylan Blvd & New Dorp Ln", "Staten Island", False, False,
     "The stop sign at Hylan and New Dorp Lane is bent sideways and hard to "
     "see until you're right at the corner."),
    # Geographic cluster: three potholes along Northern Blvd
    ("INC-1009", "POTHOLE", "MEDIUM", 60, 40.7560, -73.8850,
     "Northern Blvd & 82nd St", "Queens", False, False,
     "Cluster of potholes in the right lane of Northern Blvd at 82nd St."),
    ("INC-1010", "POTHOLE", "MEDIUM", 55, 40.7566, -73.8790,
     "Northern Blvd & 88th St", "Queens", False, False,
     "Big pothole on Northern Blvd near 88th St, right where the buses pull in."),
    ("INC-1011", "POTHOLE", "LOW", 50, 40.7572, -73.8730,
     "Northern Blvd & 94th St", "Queens", False, False,
     "Pavement is breaking up on Northern Blvd around 94th St. A few small "
     "potholes forming."),
    ("INC-1012", "TRAFFIC_SIGNAL", "HIGH", 40, 40.8078, -73.9454,
     "W 125th St & Lenox Ave", "Manhattan", False, True,
     "The traffic light at 125th and Lenox is stuck on red in every direction. "
     "Drivers are getting impatient and running it."),
    ("INC-1013", "ROAD_OBSTRUCTION", "MEDIUM", 90, 40.6100, -73.9670,
     "Ocean Pkwy & Avenue P", "Brooklyn", True, False,
     "A mattress and a broken dresser are sitting in the service lane of Ocean "
     "Pkwy near Avenue P. Cars keep merging around them."),
]

# Work the busy crews are currently doing (status ASSIGNED / IN_PROGRESS)
BUSY_INCIDENTS = [
    # Crew Bravo's stack (overloaded road crew, Manhattan)
    ("INC-1014", "POTHOLE", "HIGH", 150, 40.7620, -73.9510,
     "FDR Dr Service Rd & E 71st St", "Manhattan", True, False,
     "Pothole the size of a manhole cover on the FDR service road. Multiple "
     "cars have blown tires this morning.", "IN_PROGRESS", "CRW-B"),
    ("INC-1015", "POTHOLE", "MEDIUM", 200, 40.7450, -73.9780,
     "E 34th St & Park Ave", "Manhattan", False, False,
     "Series of potholes across the intersection at 34th and Park.", "ASSIGNED", "CRW-B"),
    ("INC-1016", "SIDEWALK_HAZARD", "MEDIUM", 240, 40.7465, -74.0014,
     "W 22nd St & 10th Ave", "Manhattan", False, True,
     "Broken curb with exposed rebar at the corner by the gallery entrance.",
     "ASSIGNED", "CRW-B"),
    # Crew Foxtrot's current job (drainage, Queens)
    ("INC-1017", "FLOODING", "HIGH", 100, 40.7700, -73.9060,
     "Astoria Blvd & Steinway St", "Queens", True, False,
     "The underpass at Astoria and Steinway floods every rain and it's a foot "
     "deep right now. One car already stalled in it.", "IN_PROGRESS", "CRW-F"),
]

# (assignment_id, incident_id, crew_id, assigned_mins_ago, eta_mins_ago, status)
ACTIVE_ASSIGNMENTS = [
    ("ASG-9001", "INC-1014", "CRW-B", 140, 118, "ON_SITE"),
    ("ASG-9002", "INC-1015", "CRW-B", 130, None, "QUEUED"),
    ("ASG-9003", "INC-1016", "CRW-B", 125, None, "QUEUED"),
    ("ASG-9004", "INC-1017", "CRW-F", 90, 72, "ON_SITE"),
]

RESOLVED_TEMPLATES = [
    ("POTHOLE", "Pothole reported in the {lane} on {street}."),
    ("STREETLIGHT_OUT", "Streetlight out on {street}, block is dark at night."),
    ("GRAFFITI", "Graffiti tags on the {surface} along {street}."),
    ("DAMAGED_SIGN", "Street sign on {street} is {problem}."),
    ("FALLEN_TREE", "Large limb down on {street} after last week's wind."),
    ("FLOODING", "Standing water on {street}, drain appears blocked."),
    ("SIDEWALK_HAZARD", "Cracked sidewalk slab on {street} near the bus stop."),
    ("ROAD_OBSTRUCTION", "Debris left in the roadway on {street}."),
]

STREETS = {
    "Brooklyn": ["Atlantic Ave", "Eastern Pkwy", "Bedford Ave", "Ocean Ave", "4th Ave", "Flatbush Ave"],
    "Manhattan": ["Broadway", "Amsterdam Ave", "2nd Ave", "W 57th St", "Canal St", "E 14th St"],
    "Queens": ["Queens Blvd", "Northern Blvd", "Roosevelt Ave", "Jamaica Ave", "Astoria Blvd"],
    "Bronx": ["Grand Concourse", "Fordham Rd", "Webster Ave", "E Tremont Ave"],
    "Staten Island": ["Victory Blvd", "Hylan Blvd", "Richmond Ave", "Forest Ave"],
}


def build_resolved_history(rng, count=18):
    """Filler history so metrics/map have texture. All RESOLVED in the past 48h."""
    rows = []
    boroughs = list(BOROUGH_ANCHORS.keys())
    for i in range(count):
        inc_id = f"INC-{1018 + i}"
        itype, template = RESOLVED_TEMPLATES[i % len(RESOLVED_TEMPLATES)]
        cap, sev, dur = INCIDENT_TYPES[itype]
        borough = boroughs[i % len(boroughs)]
        lat0, lon0 = BOROUGH_ANCHORS[borough]
        lat = round(lat0 + rng.uniform(-0.03, 0.03), 4)
        lon = round(lon0 + rng.uniform(-0.03, 0.03), 4)
        street = rng.choice(STREETS[borough])
        desc = template.format(
            street=street,
            lane=rng.choice(["right lane", "center lane", "bus lane"]),
            surface=rng.choice(["retaining wall", "roll-down gates", "underpass"]),
            problem=rng.choice(["bent over", "spun the wrong way", "knocked flat"]),
        )
        reported = rng.randint(360, 2880)          # 6h to 48h ago
        resolved = reported - rng.randint(60, 300)  # resolved 1-5h after report
        rows.append({
            "incident_id": inc_id, "reported_at": minutes_ago(reported),
            "source": rng.choice(["PHONE", "APP", "WEB"]), "description": desc,
            "incident_type": itype, "severity": sev, "status": "RESOLVED",
            "latitude": lat, "longitude": lon,
            "address": f"{street}, {borough}", "borough": borough,
            "required_capability": cap, "estimated_duration_minutes": dur,
            "road_obstruction": False, "safety_risk": False,
            "priority_score": priority_score(sev, False, False, 0),
            "duplicate_of": "", "assigned_crew_id": "",
            "resolved_at": minutes_ago(max(resolved, 30)),
        })
    return rows


def incident_row(inc, status="OPEN", assigned_crew=""):
    (inc_id, itype, sev, mins, lat, lon, address, borough, obstruction, safety, desc) = inc[:11]
    cap, _, dur = INCIDENT_TYPES[itype]
    return {
        "incident_id": inc_id, "reported_at": minutes_ago(mins),
        "source": "PHONE" if int(inc_id[-1]) % 2 else "APP", "description": desc,
        "incident_type": itype, "severity": sev, "status": status,
        "latitude": lat, "longitude": lon, "address": address, "borough": borough,
        "required_capability": cap, "estimated_duration_minutes": dur,
        "road_obstruction": obstruction, "safety_risk": safety,
        "priority_score": priority_score(sev, obstruction, safety, mins),
        "duplicate_of": "", "assigned_crew_id": assigned_crew, "resolved_at": "",
    }


# ---------------------------------------------------------------------------
# Live-demo raw requests (unclassified: this is what AIP Logic processes)
# ---------------------------------------------------------------------------

SCENARIO_1 = [
    ("REQ-2001", 0, "APP", 40.6863, -73.9846, "Brooklyn",
     "Large pothole opened up right in the middle of Atlantic Ave near Bond St. "
     "Cars are swerving into the next lane to avoid it."),
]

SCENARIO_2_STORM = [
    ("REQ-2002", 0, "PHONE", 40.6721, -73.9550, "Brooklyn",
     "A whole tree just came down across Eastern Parkway by Classon Ave in the "
     "storm. Both lanes on this side are blocked and branches are on a parked car."),
    ("REQ-2003", 0, "APP", 40.7330, -73.8700, "Queens",
     "Queens Blvd underpass at 65th is flooding fast. Water is up to the car "
     "doors and one sedan is stuck in the middle of it with people inside."),
    ("REQ-2004", 1, "PHONE", 40.6840, -73.9770, "Brooklyn",
     "The traffic signal at Atlantic and Flatbush went completely dark in the "
     "storm. It's a six-way intersection and nobody knows who has the right of way."),
    ("REQ-2005", 1, "WEB", 40.6650, -73.9890, "Brooklyn",
     "Wind blew a bunch of construction barriers and plywood across 4th Ave "
     "near 9th St. Drivers are getting out to drag them off the road."),
    ("REQ-2006", 2, "PHONE", 40.6350, -73.9530, "Brooklyn",
     "A streetlight pole snapped on Ocean Ave near Farragut and it's leaning on "
     "the wires. There were sparks when it happened."),
]

SCENARIO_3_DUPLICATE = [
    ("REQ-2007", 0, "WEB", 40.6779, -73.9718, "Brooklyn",
     "There's a big tree that fell across Flatbush Avenue right by the 7th Ave "
     "intersection. One lane is totally blocked and traffic is a mess."),
]


def write_csv(path, rows, fieldnames):
    with open(path, "w", newline="") as f:
        # Unix line endings: must match the \n recordDelimiter in the Foundry schema.
        w = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: (str(v).lower() if isinstance(v, bool) else v) for k, v in r.items()})
    print(f"  wrote {path} ({len(rows)} rows)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(Path(__file__).parent))
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)

    # incidents.csv
    incident_fields = [
        "incident_id", "reported_at", "source", "description", "incident_type",
        "severity", "status", "latitude", "longitude", "address", "borough",
        "required_capability", "estimated_duration_minutes", "road_obstruction",
        "safety_risk", "priority_score", "duplicate_of", "assigned_crew_id", "resolved_at",
    ]
    incidents = [incident_row(i) for i in OPEN_INCIDENTS]
    incidents += [incident_row(i[:11], status=i[11], assigned_crew=i[12]) for i in BUSY_INCIDENTS]
    incidents += build_resolved_history(rng)
    write_csv(out / "incidents.csv", incidents, incident_fields)

    # crews.csv
    crew_fields = ["crew_id", "crew_name", "capability", "latitude", "longitude",
                   "borough", "status", "current_workload", "max_workload",
                   "shift_start", "shift_end", "vehicle"]
    write_csv(out / "crews.csv", [dict(zip(crew_fields, c)) for c in CREWS], crew_fields)

    # assignments.csv (active + a few completed for history)
    asg_fields = ["assignment_id", "incident_id", "crew_id", "assigned_at",
                  "estimated_arrival", "status", "completed_at"]
    assignments = []
    for asg_id, inc_id, crew_id, assigned, eta, status in ACTIVE_ASSIGNMENTS:
        assignments.append({
            "assignment_id": asg_id, "incident_id": inc_id, "crew_id": crew_id,
            "assigned_at": minutes_ago(assigned),
            "estimated_arrival": minutes_ago(eta) if eta else "",
            "status": status, "completed_at": "",
        })
    resolved_ids = [r["incident_id"] for r in incidents if r["status"] == "RESOLVED"][:6]
    crew_ids = [c[0] for c in CREWS]
    for i, inc_id in enumerate(resolved_ids):
        assigned = rng.randint(400, 2800)
        assignments.append({
            "assignment_id": f"ASG-{9005 + i}", "incident_id": inc_id,
            "crew_id": crew_ids[i % len(crew_ids)],
            "assigned_at": minutes_ago(assigned),
            "estimated_arrival": minutes_ago(assigned - 20),
            "status": "COMPLETED", "completed_at": minutes_ago(assigned - rng.randint(60, 200)),
        })
    write_csv(out / "assignments.csv", assignments, asg_fields)

    # capabilities.csv
    cap_fields = ["capability_id", "name", "description", "typical_crew_size"]
    write_csv(out / "capabilities.csv", [dict(zip(cap_fields, c)) for c in CAPABILITIES], cap_fields)

    # scenario request files (raw, unclassified)
    req_fields = ["request_id", "received_at", "channel", "latitude", "longitude", "borough", "description"]
    for name, rows in [("scenario1_new_request.csv", SCENARIO_1),
                       ("scenario2_storm_requests.csv", SCENARIO_2_STORM),
                       ("scenario3_duplicate_request.csv", SCENARIO_3_DUPLICATE)]:
        write_csv(out / name, [{
            "request_id": r[0], "received_at": minutes_ago(-r[1] if r[1] else 0),
            "channel": r[2], "latitude": r[3], "longitude": r[4],
            "borough": r[5], "description": r[6],
        } for r in rows], req_fields)

    print(f"\nDone. Timestamps are relative to {NOW.isoformat()}.")
    print("Regenerate right before a demo so the queue looks live.")


if __name__ == "__main__":
    main()
