#!/usr/bin/env python3
"""Builds the Edge extension from vici-property-lookup.user.js.

   python3 build-extension.py      -> extension/build/ (load unpacked) + dist/<name>-<version>.zip (upload to Partner Center)
"""
import json, os, re, shutil, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(ROOT, 'vici-property-lookup.user.js'), encoding='utf-8').read()
version = re.search(r'@version\s+([\d.]+)', src).group(1)
body = src[src.index('// ==/UserScript==') + len('// ==/UserScript=='):]

ext = os.path.join(ROOT, 'extension')
out = os.path.join(ext, 'build')
shutil.rmtree(out, ignore_errors=True)
os.makedirs(os.path.join(out, 'icons'))

head = open(os.path.join(ext, 'src', 'shim-head.js'), encoding='utf-8').read()
tail = open(os.path.join(ext, 'src', 'shim-tail.js'), encoding='utf-8').read()
open(os.path.join(out, 'content.js'), 'w', encoding='utf-8').write(head + body + '\n' + tail)
shutil.copy(os.path.join(ext, 'src', 'background.js'), out)
for f in os.listdir(os.path.join(ext, 'icons')):
    if f.startswith('icon'):
        shutil.copy(os.path.join(ext, 'icons', f), os.path.join(out, 'icons'))

manifest = {
    'manifest_version': 3,
    'name': 'Mortgageusa Property Lookup',
    'short_name': 'Property Lookup',
    'version': version,
    'description': 'Adds Zillow, Realtor.com, Homes.com and Trulia property tabs to the Mortgageusa VICIdial agent screen.',
    'icons': {s: f'icons/icon{s}.png' for s in ('16', '32', '48', '128')},
    'background': {'service_worker': 'background.js'},
    'permissions': ['storage', 'declarativeNetRequestWithHostAccess'],
    'host_permissions': [
        'https://www.zillowstatic.com/*', 'https://parser-external.geo.moveaws.com/*',
        'https://www.zillow.com/*', 'https://www.trulia.com/*', 'https://www.realtor.com/*'],
    'content_scripts': [{
        'matches': ['https://mtgusa.talkitpro.com/agc/*', 'http://mtgusa.talkitpro.com/agc/*', 'https://mtgusa.talkitpro.com/vicidial/admin_listloader*', 'http://mtgusa.talkitpro.com/vicidial/admin_listloader*', 'https://www.homes.com/*'],
        'js': ['content.js'], 'run_at': 'document_start'}],
}
json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w'), indent=2)

os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
zpath = os.path.join(ROOT, 'dist', f'mortgageusa-property-lookup-{version}.zip')
with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
    for dp, _, files in os.walk(out):
        for f in files:
            p = os.path.join(dp, f)
            z.write(p, os.path.relpath(p, out))
print('built', version, '->', zpath)
