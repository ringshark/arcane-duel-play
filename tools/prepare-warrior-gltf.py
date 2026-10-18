"""Keep and normalize the strongest four skin influences for Three.js r160.

Run on the Godot-exported browser GLB; animation channels and image data are
preserved. Running it again is a no-op. Uses only the Python standard library.
"""
import json
import struct
import sys
from pathlib import Path

def prepare(path):
    blob = path.read_bytes()
    magic, version, _ = struct.unpack_from('<III', blob)
    assert magic == 0x46546C67 and version == 2
    json_size, json_type = struct.unpack_from('<II', blob, 12)
    assert json_type == 0x4E4F534A
    doc = json.loads(blob[20:20+json_size])
    offset = 20+json_size
    bin_size, bin_type = struct.unpack_from('<II', blob, offset)
    assert bin_type == 0x004E4942
    binary = bytearray(blob[offset+8:offset+8+bin_size])
    def accessor(index, component):
        a = doc['accessors'][index]
        assert a['componentType'] == component and a['type'] == 'VEC4'
        v = doc['bufferViews'][a['bufferView']]
        width = 2 if component == 5123 else 4
        return a['count'], v.get('byteOffset', 0)+a.get('byteOffset', 0), v.get('byteStride', width*4)
    count = 0
    worst = 0.0
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            attrs = primitive['attributes']
            if 'JOINTS_1' not in attrs:
                continue
            js = [accessor(attrs['JOINTS_'+str(i)], 5123) for i in range(2)]
            ws = [accessor(attrs['WEIGHTS_'+str(i)], 5126) for i in range(2)]
            assert len({a[0] for a in js+ws}) == 1
            for vertex in range(js[0][0]):
                joints = sum((list(struct.unpack_from('<4H', binary, a[1]+vertex*a[2])) for a in js), [])
                weights = sum((list(struct.unpack_from('<4f', binary, a[1]+vertex*a[2])) for a in ws), [])
                ranked = sorted(zip(weights, joints), reverse=True)[:4]
                total = sum(w for w, _ in ranked)
                assert total > 0, 'Vertex has no skin weights'
                worst = max(worst, sum(weights)-total)
                struct.pack_into('<4H', binary, js[0][1]+vertex*js[0][2], *(j for _, j in ranked))
                struct.pack_into('<4f', binary, ws[0][1]+vertex*ws[0][2], *(w/total for w, _ in ranked))
                count += 1
            del attrs['JOINTS_1']
            del attrs['WEIGHTS_1']
    if not count:
        print('Already prepared: four-influence skin')
        return
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary += b'\0' * (-len(binary) % 4)
    size = 12+8+len(encoded)+8+len(binary)
    result = struct.pack('<III', magic, version, size)
    result += struct.pack('<II', len(encoded), json_type)+encoded
    result += struct.pack('<II', len(binary), bin_type)+binary
    path.write_bytes(result)
    print(f'Prepared {count} vertices; largest discarded influence sum {worst:.4f}')

if __name__ == '__main__':
    prepare(Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'assets/warrior/warrior.glb')
