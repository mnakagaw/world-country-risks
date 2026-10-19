"""Guard the existing owner's cold build/publication outputs before each write."""
from pathlib import Path
import ctypes,json,os,shutil

def external_root(additional_bytes,registry=None):
    registry=Path(registry or Path.home()/'.codex/storage-placement.json')
    policy=json.loads(registry.read_bytes());root=Path(policy['external_root'])
    if os.name!='nt' or not root.is_dir():raise OSError('registered external storage unavailable; no C fallback')
    marker=json.loads(Path(policy['marker_path']).read_bytes());volume=policy['volume']
    guid,label,filesystem=(ctypes.create_unicode_buffer(1024) for _ in range(3))
    from ctypes import wintypes
    serial,max_name,flags=(wintypes.DWORD() for _ in range(3));api=ctypes.WinDLL('kernel32',use_last_error=True)
    if not api.GetVolumeNameForVolumeMountPointW(volume['mount'],guid,len(guid)):raise ctypes.WinError(ctypes.get_last_error())
    if not api.GetVolumeInformationW(volume['mount'],label,len(label),ctypes.byref(serial),ctypes.byref(max_name),ctypes.byref(flags),filesystem,len(filesystem)):raise ctypes.WinError(ctypes.get_last_error())
    observed={'volume_guid':guid.value,'volume_label':label.value,'filesystem':filesystem.value,'volume_serial_hex':f'{serial.value:08X}'}
    if (marker.get('kind')!='codex-external-storage-volume-v1' or marker.get('marker_id')!=policy['marker_id']
        or Path(marker['root'])!=root or marker.get('volume')!=volume
        or any(observed[k].casefold()!=volume[k].casefold() for k in observed)):
        raise OSError('external volume identity mismatch; no C fallback')
    if type(additional_bytes) is not int or additional_bytes<0:raise ValueError('invalid peak size')
    if shutil.disk_usage(root).free-additional_bytes<policy['minimum_free_bytes']:raise OSError('external capacity deferred')
    return root

def daily_paths(repo,policy,day,key):
    if policy.get('external_storage') is not True:return Path(repo)/'dist',Path(repo)/'.local/releases'
    public=Path(repo)/'public';size=sum(p.stat().st_size for p in public.rglob('*') if p.is_file())
    root=external_root(size*2+1024**3)
    # Active bounded source read cache stays on NVMe; cold duplicate builds do not.
    if shutil.disk_usage(Path(repo).anchor).free-8*1024**3<20*1024**3:raise OSError('C source-work headroom deferred')
    base=root/'world-country-risks'/'daily'/day/key
    return base/'dist',base/'publications'
