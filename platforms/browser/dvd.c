/* SPDX-License-Identifier: GPL-3.0-or-later */
#include <aurora/dvd.h>
#include <dolphin/dvd.h>
#include <emscripten.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
// clang-format off
/* Reads `size` bytes at `off` within one file of the extracted disc, fetched by
 * name from iso/<path> beside the page. Returns the bytes read (short at the end
 * of the file), or -1 when the file cannot be fetched.
 * ponytail: unbounded per-name map of whole files; evict if memory matters. */
EM_JS(int, browser_file_read, (const char* path,void* dst,unsigned off,unsigned size), {
 // A suspended miss may be a cache hit when Asyncify replays this call.
 if(Asyncify.state===Asyncify.State.Rewinding)return Asyncify.handleAsync(async()=>0);
 const name=UTF8ToString(path);
 const files=Module.isoFiles||(Module.isoFiles=new Map());
 const copy=b=>{const n=Math.min(size,Math.max(0,b.byteLength-off));HEAPU8.set(new Uint8Array(b,off,n),dst);return n;};
 const hit=files.get(name);
 if(hit)return copy(hit);
 return Asyncify.handleAsync(async()=>{
  try{
   const r=await fetch('iso/'+name);
   if(!r.ok)throw new Error('HTTP '+r.status);
   const b=await r.arrayBuffer();
   files.set(name,b);
   return copy(b);
  }catch(e){console.error('iso read',name,e);return -1;}
 });
});
// clang-format on
typedef struct DiscCompletion {
    struct DiscCompletion* next;
    DVDFileInfo* file;
    DVDCallback callback;
    int result;
} DiscCompletion;
static DiscCompletion *completion_head, *completion_tail;
void browser_disc_deliver(void) {
    static int delivering;
    if (delivering)
        return;
    delivering = 1;
    DiscCompletion* end = completion_tail;
    while (completion_head) {
        DiscCompletion* c = completion_head;
        completion_head = c->next;
        if (!completion_head)
            completion_tail = NULL;
        c->file->cb.state = c->result < 0 ? DVD_STATE_FATAL_ERROR : DVD_STATE_END;
        if (c->callback)
            c->callback(c->result, c->file);
        int last = c == end;
        free(c);
        if (last)
            break;
    }
    delivering = 0;
}
static uint32_t be32(const unsigned char* p) {
    return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3];
}
static unsigned char *fst, *dol;
static unsigned fst_size, dol_size, entries;
static char** paths; /* per FST entry: its path in the extraction, files/... */
static DVDDiskID disc_id;
static unsigned field(unsigned n, unsigned word) {
    return be32(fst + n * 12 + word * 4);
}
static int isdir(unsigned n) {
    return field(n, 0) >> 24;
}
static const char* name(unsigned n) {
    return (char*)fst + entries * 12 + (field(n, 0) & 0xffffff);
}
/* The FST lists a directory's children right after it, up to its end index
 * (word 2), so a stack of open directories gives every entry its parent. */
static bool build_paths(void) {
    paths = calloc(entries, sizeof(*paths));
    unsigned open[16];
    int depth = 0;
    open[0] = 0;
    if (!paths)
        return false;
    paths[0] = (char*)"files";
    for (unsigned n = 1; n < entries; n++) {
        while (depth > 0 && n >= field(open[depth], 2))
            depth--;
        const char* parent = paths[open[depth]];
        size_t len = strlen(parent) + strlen(name(n)) + 2;
        char* p = malloc(len);
        if (!p)
            return false;
        snprintf(p, len, "%s/%s", parent, name(n));
        paths[n] = p;
        if (isdir(n)) {
            if (depth + 1 >= (int)(sizeof(open) / sizeof(*open)))
                return false;
            open[++depth] = n;
        }
    }
    return true;
}
/* The disc header, the DOL and the FST come from sys/ by name, as nod lays an
 * extraction out; nothing is read at a disc address. */
bool aurora_dvd_open(const char* path) {
    (void)path;
    unsigned char h[0x440];
    if (browser_file_read("sys/boot.bin", h, 0, sizeof(h)) != sizeof(h) || memcmp(h, "GALE01", 6) ||
        h[7] != 2)
        return false;
    memcpy(&disc_id, h, 32);
    unsigned d = be32(h + 0x420), f = be32(h + 0x424);
    fst_size = be32(h + 0x428);
    if (f <= d || f - d > 8 * 1024 * 1024 || fst_size > 8 * 1024 * 1024)
        return false;
    /* f - d bounds the DOL from above (the disc pads it); main.dol is its
     * real length, the one nod hands the native build. */
    dol = malloc(f - d);
    fst = malloc(fst_size);
    if (!dol || !fst)
        return false;
    int got = browser_file_read("sys/main.dol", dol, 0, f - d);
    if (got <= 0 || browser_file_read("sys/fst.bin", fst, 0, fst_size) != fst_size)
        return false;
    dol_size = got;
    entries = field(0, 2);
    return entries > 0 && entries * 12 < fst_size && build_paths();
}
/* Only the entry points this target links are implemented: the game opens by
 * entry number and reads asynchronously (lbfile.c, devcom.c); src/pc needs the
 * DOL, the disc ID and the entry count. An unreferenced DVD call is a link
 * error (-sERROR_ON_UNDEFINED_SYMBOLS), so a future caller cannot be missed. */
void DVDInit(void) {}
const u8* DVDGetDOLLocation(s32* n) {
    *n = dol_size;
    return dol;
}
DVDDiskID* DVDGetCurrentDiskID(void) {
    return &disc_id;
}
BOOL DVDCheckDisk(void) {
    return fst != NULL;
}
/* The game polls this while it waits on a read, which makes it the place to
 * deliver completions and return to the event loop. */
s32 DVDGetDriveStatus(void) {
    browser_disc_deliver();
    extern void browser_arq_deliver(void);
    browser_arq_deliver();
    extern void pc_audio_pump(void);
    pc_audio_pump();
    extern void browser_yield(void);
    browser_yield();
    return DVD_STATE_END;
}
/* aurora/dvd.h surface used by src/pc outside the DVD API proper. */
int aurora_dvd_inflight(void) {
    /* Reads finish inside the call; what can still be pending is a completion
     * callback queued for the next pc_os_run_alarms. */
    int n = 0;
    for (const DiscCompletion* c = completion_head; c; c = c->next)
        n++;
    return n;
}
s32 aurora_dvd_base_entry_count(void) {
    return (s32)entries;
}
void aurora_dvd_set_locale_extension(const char* ext) {
    (void)ext; /* GALE01 only */
}
s32 DVDConvertPathToEntrynum(const char* path) {
    if (!fst || !path)
        return -1;
    char full[1024];
    if (strlen(path) >= sizeof(full))
        return -1;
    strcpy(full, path);
    unsigned current = 0;
    char* save = NULL;
    for (char* t = strtok_r(full, "/", &save); t; t = strtok_r(NULL, "/", &save)) {
        if (!strcmp(t, "."))
            continue;
        if (!strcmp(t, "..")) {
            current = field(current, 1);
            continue;
        }
        unsigned i = current + 1, end = field(current, 2);
        for (; i < end;) {
            if (!strcmp(name(i), t))
                break;
            i = isdir(i) ? field(i, 2) : i + 1;
        }
        if (i == end)
            return -1;
        current = i;
    }
    return current;
}
BOOL DVDFastOpen(s32 n, DVDFileInfo* f) {
    if (n < 0 || (unsigned)n >= entries || isdir(n))
        return false;
    memset(f, 0, sizeof(*f));
    /* The browser reads by name, never at a disc address, so startAddr holds
     * the FST entry number; nothing outside this file reads it. */
    f->startAddr = n;
    f->length = field(n, 2);
    return true;
}
BOOL DVDClose(DVDFileInfo* f) {
    f->cb.state = DVD_STATE_END;
    return true;
}
static s32 read_file(DVDFileInfo* f, void* p, s32 n, s32 off) {
    if (n < 0 || off < 0 || (unsigned)off > f->length)
        return -1;
    unsigned actual = n;
    if (actual > f->length - off)
        actual = f->length - off;
    int got = browser_file_read(paths[f->startAddr], p, off, actual);
    if (got < 0 || (unsigned)got != actual)
        return -1;
    if (actual < (unsigned)n)
        memset((char*)p + actual, 0, n - actual);
    f->cb.transferredSize = n;
    return n;
}
/* The read itself completes here (a cache miss suspends the wasm); only the
 * callback is deferred, to the next browser_disc_deliver. */
BOOL DVDReadAsyncPrio(DVDFileInfo* f, void* p, s32 n, s32 o, DVDCallback cb, s32 prio) {
    (void)prio;
    int r = read_file(f, p, n, o);
    DiscCompletion* c = malloc(sizeof(*c));
    if (!c)
        abort();
    *c = (DiscCompletion){NULL, f, cb, r};
    if (completion_tail)
        completion_tail->next = c;
    else
        completion_head = c;
    completion_tail = c;
    f->cb.state = DVD_STATE_BUSY;
    return r >= 0;
}
