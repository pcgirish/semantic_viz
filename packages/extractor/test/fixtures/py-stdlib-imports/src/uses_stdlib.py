import argparse
import contextvars
import decimal
import email
import fcntl
import fractions
import hmac
import ipaddress
import requests
import secrets
import smtplib
import ssl
import tempfile
import unittest
import urllib
import uuid


def build_parser() -> argparse.ArgumentParser:
    return argparse.ArgumentParser()
