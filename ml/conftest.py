"""Make ml/ modules importable by their bare names in tests, matching the way
api.py imports them (`from census_filter import ...`) and the Docker app root
(the image copies ml/ contents to /app). Keeps test imports identical to
production imports and lets coverage target modules by their real names.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
