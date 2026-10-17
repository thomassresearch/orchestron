"""Compile a temporary preview, then save Granular Capture through the backend API."""
import argparse
import json
from pathlib import Path

import httpx

from examples.instruments.granular_capture.build import build


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-url', default='http://localhost:8000/api')
    parser.add_argument('--update-id', help='Explicit existing library ID to replace after compile preflight')
    args=parser.parse_args()
    patch=build()
    with httpx.Client(base_url=args.api_url, timeout=60) as client:
        def call(method,path,**kwargs):
            response=client.request(method,path,**kwargs)
            response.raise_for_status()
            return response.json() if response.content else None
        call('GET','/health')
        payload=patch.model_dump(mode='json',by_alias=True)
        preview=call('POST','/sessions/preview',json=dict(patches=[payload],session=dict(
            instruments=[dict(id='capture-preview',patch_id=patch.id,midi_channel=0)])))
        try:
            compiled=call('POST',f"/sessions/{preview['session_id']}/compile")
            assert 'opcode vcs_stereo_capture,' in compiled['orc']
        finally:
            call('DELETE',f"/sessions/{preview['session_id']}")
        existing=[item for item in call('GET','/patches') if item['name']==patch.name]
        if existing:
            saved=call('GET',f"/patches/{existing[0]['id']}")
            if saved['graph']!=payload['graph'] and args.update_id == saved['id']:
                saved=call('PUT',f"/patches/{saved['id']}",json=patch.model_dump(mode='json',exclude={'id','created_at','updated_at'}))
            elif saved['graph']!=payload['graph']:
                raise RuntimeError('A different Granular Capture already exists; preserve it and choose a new name.')
        else:
            saved=call('POST','/patches',json=patch.model_dump(mode='json',exclude={'id','created_at','updated_at'}))
        output=Path('output/granular-capture/library.json')
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps(saved,indent=2)+'\n')
        print(json.dumps({'id':saved['id'],'name':saved['name'],'instrument_type':saved['instrument_type']}))


if __name__=='__main__':
    main()
