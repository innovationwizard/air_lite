from setuptools import find_packages, setup

setup(
    name="airefill",
    packages=find_packages(exclude=["airefill_tests"]),
    install_requires=[
        "dagster",
        "dagster-cloud",
        "pandas>=2.0.0",
        "numpy>=1.24.0",
        "sqlalchemy>=2.0.0",
        "psycopg2-binary>=2.9.5",
        "openpyxl>=3.1.0",
    ],
    extras_require={"dev": ["dagster-webserver", "pytest"]},
)
