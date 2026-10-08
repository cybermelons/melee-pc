# SPDX-License-Identifier: GPL-3.0-or-later
# Write melee_browser.wasm.gz and melee_browser.js.gz beside the build output,
# for a static host to serve to a client that sends Accept-Encoding: gzip.
# Run by the melee_browser POST_BUILD step with -DMELEE_GZIP_DIR set.
#
# Nothing here is required at runtime: a host that does not know about the .gz
# files serves the originals, which is correct but sends 16.2 MB instead of
# 5.3 MB.
if(NOT DEFINED MELEE_GZIP_DIR)
  message(FATAL_ERROR "MELEE_GZIP_DIR is not set")
endif()

find_program(GZIP_EXE gzip)

foreach(name melee_browser.wasm melee_browser.js)
  set(source "${MELEE_GZIP_DIR}/${name}")
  set(packed "${source}.gz")
  if(NOT EXISTS "${source}")
    message(WARNING "${source} does not exist, so no ${name}.gz was written")
    continue()
  endif()
  if(GZIP_EXE)
    # -9: the build pays the slow compression once per build, and every visitor
    # gets the smaller body. -n leaves the name and timestamp out, so two
    # builds of the same input produce the same bytes.
    execute_process(COMMAND "${GZIP_EXE}" -9 -n -c "${source}"
      OUTPUT_FILE "${packed}" RESULT_VARIABLE status)
  else()
    # CMake has no gzip of its own; a .tar.gz of one file is not a gzip stream,
    # so there is no portable fallback here. The originals still serve.
    message(WARNING "gzip not found: a host will send ${name} uncompressed")
    continue()
  endif()
  if(NOT status EQUAL 0)
    # Remove a partial file rather than leave one a host would serve as a
    # complete body.
    file(REMOVE "${packed}")
    message(FATAL_ERROR "gzip failed on ${source} (status ${status})")
  endif()
endforeach()
