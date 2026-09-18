#!/usr/bin/env python3
"""Subprocess example: node bench/run.js --agent 'cmd:python agents/examples/subprocess.py'"""
import json, sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg["type"] == "hello":
        print(json.dumps({"name": "example-py", "version": "1", "protocol": "flip7-agent/1"}), flush=True)
    elif msg["type"] == "move":
        g = msg["request"]["game"]
        me = next(p for p in g["players"] if p["id"] == g["you"])
        if g["decision"]["type"] == "choose_target":
            action = g["legal_actions"][0]
        else:
            action = "hit" if me["round_score"] < 20 else "stay"
        print(json.dumps({"request_id": msg["request_id"], "action": action}), flush=True)
