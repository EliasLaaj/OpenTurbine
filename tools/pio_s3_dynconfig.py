Import("env")

dynconfig_by_env = {
    "esp32dev": "xtensa_esp32.so",
    "esp32s3dev": "xtensa_esp32s3.so",
}

dynconfig = dynconfig_by_env.get(env["PIOENV"])

if dynconfig:
    import os
    import shutil

    toolchain_dir = env.PioPlatform().get_package_dir("toolchain-xtensa-esp-elf")
    src = os.path.join(toolchain_dir or "", "lib", dynconfig)
    dst = os.path.join(env.subst("$PROJECT_DIR"), dynconfig)
    if os.path.exists(src):
        if (not os.path.exists(dst) or
                os.path.getmtime(src) > os.path.getmtime(dst) or
                os.path.getsize(src) != os.path.getsize(dst)):
            shutil.copy2(src, dst)

    env.Append(
        CCFLAGS=[f"-mdynconfig={dynconfig}"],
        CXXFLAGS=[f"-mdynconfig={dynconfig}"],
        ASFLAGS=[f"--dynconfig={dynconfig}"],
        LINKFLAGS=[
            f"-mdynconfig={dynconfig}",
            "-Wl,-EL",
        ],
    )


def patch_async_webserver_request(env):
    """Let the HTTP peer close completed ``Connection: close`` responses.

    ESPAsyncWebServer 3.11.2 actively closes completed responses. The prebuilt
    ESP32 lwIP has only 16 active PCBs and a 60 s MSL, so rapid cold connections
    can fill TIME_WAIT. Let the conforming peer close the advertised response;
    the server's existing RX timeout cleans up a stalled peer.
    """
    import os

    source_dir = os.path.join(
        env.subst("$PROJECT_LIBDEPS_DIR"), env["PIOENV"], "ESPAsyncWebServer", "src")
    request_cpp = os.path.join(source_dir, "WebRequest.cpp")
    if not os.path.exists(request_cpp):
        return

    with open(request_cpp, "r", encoding="utf-8") as handle:
        text = handle.read()
    patched_method = """void AsyncWebServerRequest::_onAck(size_t len, uint32_t time) {
  // os_printf("a:%u:%u\\n", len, time);
  if (!_response) {
    return;
  }

  if (!_response->_finished()) {
    _response->_ack(this, len, time);
    // The response advertises Connection: close. Let the peer send FIN after
    // receiving the full body so the ECU does not retain a TIME_WAIT PCB.
  } else {
    // Single-send responses are also retired by the peer or RX timeout.
  }
}"""
    start = text.find("void AsyncWebServerRequest::_onAck(size_t len, uint32_t time) {")
    end_marker = "\n}\n\nvoid AsyncWebServerRequest::_onError"
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise RuntimeError("ESPAsyncWebServer ACK handler changed; review pinned dependency")
    current_method = text[start:end + 2]
    if current_method != patched_method:
        patched = text[:start] + patched_method + text[end + 2:]
        with open(request_cpp, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(patched)


patch_async_webserver_request(env)
