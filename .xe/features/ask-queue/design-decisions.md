
## The Chief of Staff's escalations live in one file Stack only answers into

**Decision**: `.stack/needs-you.json` is written by the Chief of Staff; Stack reads it into Needs you and writes only `answer` on an item. Anything in Needs you is removed from Home.

**Date**: 2026-11-01

**Why**: Needs you must be short and trusted: only CoS-escalated decisions, each with a recommendation, a default if the owner stays silent, and a working link. A shared file removes relay messages, and the answer lands where the CoS already reads.

**Rejected**: Relaying through the inbox (a second channel to keep in sync); deriving Needs you from every 🙋 row (the noise the owner complained about); letting Stack add or remove items (the CoS owns the list).
