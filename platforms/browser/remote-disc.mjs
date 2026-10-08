// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The disc image served at a URL, shaped like the File the disc cache expects:
 * a byte length and slice(start, end).arrayBuffer(). createDiscCache does the
 * block sizing and eviction, so this only has to answer one Range request.
 *
 * Returns null when the server has no disc, so the page falls back to the
 * file picker rather than failing to start.
 */
export async function openRemoteDisc(url = './disc') {
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) return null;
  const size = Number(head.headers.get('content-length'));
  // Without byte ranges the whole 1.4 GB would arrive for every block read.
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  if (head.headers.get('accept-ranges') !== 'bytes') throw Error('The server will not serve disc byte ranges.');

  return {
    size,
    slice(start, end) {
      return {
        async arrayBuffer() {
          const response = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
          // A 200 here means the range was ignored and the body is the whole
          // image, which would silently read the wrong offset.
          if (response.status !== 206) throw Error(`Disc range request returned ${response.status}.`);
          return response.arrayBuffer();
        },
      };
    },
  };
}
