"""Guard the existing owner's cold build/publication outputs before each write."""
from pathlib import Path,PurePosixPath
from hashlib import sha256
import ctypes,json,os,re,shutil

# Empty until the complete bounded owner/writer chain has been reviewed. A plan
# declaration alone must never lower the existing owner's admission estimate.
REVIEWED_C_WRITE_CHAINS=frozenset()
C_RESERVE_BYTES=20*1024**3
DEFAULT_C_PEAK_BYTES=8*1024**3
BOUNDED_SPILL_BYTES=512*1024**2
ALLOCATION_ALLOWANCE_BYTES=64*1024
BOUNDED_MISC_BYTES=256*1024**2

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

def bounded_c_peak(repo,plan,public_bytes,public_files):
    """Validate an exact reviewed writer chain and its finite C write inventory.

    The caller must actually enforce every listed per-file ceiling. Root review
    approves a full code chain only after verifying that no C writer is omitted.
    Unknown or changed implementations defer; they cannot opt into a small peak
    merely by declaring one. Public hydration is measured here, never supplied
    as an optimistic caller estimate.
    """
    repo=Path(repo).resolve()
    if not isinstance(plan,dict) or set(plan)!={'kind','writer_chain','spill_limit_bytes','writes'}:
        raise OSError('bounded C write plan schema deferred')
    if plan['kind']!='wcr-bounded-c-write-plan-v1' or plan['spill_limit_bytes']!=BOUNDED_SPILL_BYTES:
        raise OSError('bounded C spill contract deferred')
    chain=plan['writer_chain']
    if not isinstance(chain,dict) or not {'scripts/source_revision_cycle.py','scripts/bounded_source_io.py'}<=set(chain):
        raise OSError('bounded C writer chain incomplete')
    for name,expected in chain.items():
        if not isinstance(name,str) or not isinstance(expected,str) or not re.fullmatch(r'[0-9a-f]{64}',expected):raise OSError('bounded C writer identity invalid')
        relative=PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts or relative.parts[:1]!=('scripts',):raise OSError('bounded C writer outside scripts')
        path=(repo/relative).resolve()
        if not path.is_relative_to(repo/'scripts') or sha256(path.read_bytes()).hexdigest()!=expected:raise OSError('bounded C writer SHA changed')
    chain_sha=sha256(json.dumps(chain,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    if chain_sha not in REVIEWED_C_WRITE_CHAINS:raise OSError('bounded C writer chain has not been reviewed')
    writes=plan['writes']
    if not isinstance(writes,list) or not writes or len(writes)>128:raise OSError('bounded C write inventory invalid')
    paths=set();total=0
    for entry in writes:
        if not isinstance(entry,dict) or set(entry)!={'path','max_bytes'}:raise OSError('bounded C write entry invalid')
        maximum=entry['max_bytes']
        if type(maximum) is not int or not 0<maximum<=64*1024**2:raise OSError('bounded C per-file ceiling invalid')
        path=Path(entry['path']).resolve();identity=os.path.normcase(str(path))
        try:parts=path.relative_to(repo/'.daily-work/source-revisions').parts
        except ValueError:parts=()
        queue_state=(len(parts)==2 and re.fullmatch(r'[A-Za-z0-9_-]{1,96}',parts[0]) and parts[1]=='state.json' and maximum<=65536)
        if not (path.is_relative_to(repo/'.local') or path.is_relative_to(repo/'public') or queue_state) or identity in paths:raise OSError('bounded C write path invalid')
        paths.add(identity);total+=maximum
    # Count both future final bytes and pending/replacement bytes. Existing public
    # placeholders can hydrate to their full logical size during Vite/HTTP checks.
    peak=public_bytes+public_files*ALLOCATION_ALLOWANCE_BYTES+BOUNDED_SPILL_BYTES+2*total+2*len(paths)*ALLOCATION_ALLOWANCE_BYTES+BOUNDED_MISC_BYTES
    return {'peak_additional_bytes':peak,'writer_chain_sha256':chain_sha,'public_hydration_bytes':public_bytes,
      'public_files':public_files,'c_file_write_ceiling_bytes':total,'c_planned_files':len(paths),
      'c_pending_factor':2,'duckdb_spill_bytes':BOUNDED_SPILL_BYTES,'misc_allowance_bytes':BOUNDED_MISC_BYTES}

def daily_paths(repo,policy,day,key,*,c_write_plan=None):
    if policy.get('external_storage') is not True:return Path(repo)/'dist',Path(repo)/'.local/releases'
    public=Path(repo)/'public';files=[p for p in public.rglob('*') if p.is_file()];size=sum(p.stat().st_size for p in files)
    root=external_root(size*2+1024**3)
    peak=DEFAULT_C_PEAK_BYTES if c_write_plan is None else bounded_c_peak(repo,c_write_plan,size,len(files))['peak_additional_bytes']
    if shutil.disk_usage(Path(repo).anchor).free-peak<C_RESERVE_BYTES:raise OSError('C source-work headroom deferred')
    base=root/'world-country-risks'/'daily'/day/key
    return base/'dist',base/'publications'
