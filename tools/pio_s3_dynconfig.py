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
    """Let the HTTP peer retire completed ``Connection: close`` responses.

    OpenTurbine explicitly sends ``Connection: close``. Chromium and normal
    HTTP clients therefore close after consuming Content-Length. If the ECU
    actively closes on the final ACK instead, its tiny lwIP table owns every
    60-second TIME_WAIT entry and a short page tour exhausts Classic. Waiting
    for the peer FIN moves TIME_WAIT to the PC/browser; the request RX timeout
    remains the bounded fallback for a non-compliant client.
    """
    import os

    source_dir = os.path.join(
        env.subst("$PROJECT_LIBDEPS_DIR"), env["PIOENV"], "ESPAsyncWebServer", "src")
    request_cpp = os.path.join(source_dir, "WebRequest.cpp")
    server_header = os.path.join(source_dir, "ESPAsyncWebServer.h")
    if not os.path.exists(request_cpp) or not os.path.exists(server_header):
        return

    with open(server_header, "r", encoding="utf-8") as handle:
        header = handle.read()
    finished_decl = "  virtual bool _finished() const;\n"
    acknowledged_decl = (
        "  virtual bool _finished() const;\n"
        "  bool _fullyAcknowledged() const {\n"
        "    return _finished() && _ackedLength >= _writtenLength;\n"
        "  }\n")
    if acknowledged_decl in header:
        header = header.replace(acknowledged_decl, finished_decl, 1)
        with open(server_header, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(header)

    with open(request_cpp, "r", encoding="utf-8") as handle:
        text = handle.read()
    original_poll = """void AsyncWebServerRequest::_onPoll() {
  // os_printf("p\\n");
  if (_response && _client && _client->canSend()) {
    _response->_ack(this, 0, 0);
  }
}"""
    retrying_poll = """void AsyncWebServerRequest::_onPoll() {
  // os_printf("p\\n");
  if (_response && _client && _client->canSend()) {
    if (!_response->_finished()) {
      _response->_ack(this, 0, 0);
    }
  }
}"""
    active_closing_poll = """void AsyncWebServerRequest::_onPoll() {
  // os_printf("p\\n");
  if (_response && _client && _client->canSend()) {
    if (!_response->_finished()) {
      _response->_ack(this, 0, 0);
    } else {
      // tcp_close() can temporarily return ERR_MEM while the final response
      // bytes remain queued in lwIP. No further ACK callback is guaranteed
      // after that final ACK, so retry graceful close from the normal poll.
      _client->close();
    }
  }
}"""
    if original_poll in text:
        text = text.replace(original_poll, retrying_poll, 1)
    elif active_closing_poll in text:
        text = text.replace(active_closing_poll, retrying_poll, 1)
    elif retrying_poll not in text:
        raise RuntimeError("ESPAsyncWebServer poll handler changed; review pinned dependency")
    patched_method = """void AsyncWebServerRequest::_onAck(size_t len, uint32_t time) {
  // os_printf("a:%u:%u\\n", len, time);
  if (!_response) {
    return;
  }

  if (!_response->_finished()) {
    _response->_ack(this, len, time);
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


def patch_async_webserver_accept(env):
    """Reject an unaffordable HTTP request instead of terminating firmware.

    ESP firmware builds have C++ exceptions disabled, but the pinned library's
    accept callback uses throwing ``new`` and then checks for ``nullptr``. On a
    fragmented Classic heap that invokes ``std::terminate`` before the check.
    """
    import os

    source_dir = os.path.join(
        env.subst("$PROJECT_LIBDEPS_DIR"), env["PIOENV"], "ESPAsyncWebServer", "src")
    server_cpp = os.path.join(source_dir, "WebServer.cpp")
    if not os.path.exists(server_cpp):
        return

    with open(server_cpp, "r", encoding="utf-8") as handle:
        text = handle.read()
    if "#include <new>" not in text:
        text = text.replace("#include <string>\n", "#include <new>\n#include <string>\n", 1)
    throwing = "AsyncWebServerRequest *r = new AsyncWebServerRequest((AsyncWebServer *)s, c);"
    safe = "AsyncWebServerRequest *r = new (std::nothrow) AsyncWebServerRequest((AsyncWebServer *)s, c);"
    if throwing in text:
        text = text.replace(throwing, safe, 1)
    elif safe not in text:
        raise RuntimeError("ESPAsyncWebServer accept callback changed; review pinned dependency")
    unguarded = """      c->setRxTimeout(3);
      AsyncWebServerRequest *r = new (std::nothrow) AsyncWebServerRequest((AsyncWebServer *)s, c);"""
    guarded = """      c->setRxTimeout(3);
#if defined(ESP32)
      // A new request still allocates parsed-header list nodes after its
      // request object is constructed. Refuse disposable new transports while
      // the Classic heap is critically low instead of letting STL terminate
      // the whole ECU inside header parsing.
      if (ESP.getFreeHeap() < 16384 || ESP.getMaxAllocHeap() < 4096) {
        c->abort();
        delete c;
        return;
      }
#endif
      AsyncWebServerRequest *r = new (std::nothrow) AsyncWebServerRequest((AsyncWebServer *)s, c);"""
    if unguarded in text:
        text = text.replace(unguarded, guarded, 1)
    elif guarded not in text:
        raise RuntimeError("ESPAsyncWebServer accept admission point changed; review dependency")
    with open(server_cpp, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def patch_async_webserver_responses(env):
    """Make core response-object allocation fail closed instead of rebooting.

    The Classic can have enough total heap for a response while lacking one
    suitably sized contiguous block after a config document was processed.
    With exceptions disabled, throwing ``new`` calls ``std::terminate``. The
    request machinery already tolerates a null response (the peer times out),
    which is preferable to resetting the ECU and is recoverable by the UI.
    """
    import os

    source_dir = os.path.join(
        env.subst("$PROJECT_LIBDEPS_DIR"), env["PIOENV"], "ESPAsyncWebServer", "src")
    request_cpp = os.path.join(source_dir, "WebRequest.cpp")
    if not os.path.exists(request_cpp):
        return

    with open(request_cpp, "r", encoding="utf-8") as handle:
        text = handle.read()
    if "#include <new>" not in text:
        include_at = text.find("#include")
        if include_at < 0:
            raise RuntimeError("ESPAsyncWebServer WebRequest includes changed; review dependency")
        text = text[:include_at] + "#include <new>\n" + text[include_at:]

    response_types = (
        "AsyncBasicResponse", "AsyncProgmemResponse", "AsyncFileResponse",
        "AsyncStreamResponse", "AsyncCallbackResponse", "AsyncChunkedResponse",
    )
    changed = False
    for response_type in response_types:
        throwing = f"new {response_type}("
        safe = f"new (std::nothrow) {response_type}("
        if throwing in text:
            text = text.replace(throwing, safe)
            changed = True
    if not changed and "new (std::nothrow) AsyncBasicResponse(" not in text:
        raise RuntimeError("ESPAsyncWebServer response allocation changed; review dependency")
    with open(request_cpp, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def patch_async_webserver_header_retention(env):
    """Retain only request headers that a handler needs after parsing.

    Chromium sends many advisory headers on every local request. The pinned
    server copied every one into an STL list for the full request lifetime,
    even though routing needs only parsed fields and WebSocket/cache handlers
    inspect a small named subset. Concurrent Classic requests could therefore
    exhaust heap in list-node allocation before low-heap middleware ran.
    """
    import os

    request_cpp = os.path.join(
        env.subst("$PROJECT_LIBDEPS_DIR"), env["PIOENV"],
        "ESPAsyncWebServer", "src", "WebRequest.cpp")
    if not os.path.exists(request_cpp):
        return
    with open(request_cpp, "r", encoding="utf-8") as handle:
        text = handle.read()
    retain_all = "    _headers.emplace_back(std::move(header));"
    retain_needed = """    // Parsed Host, Content-Type/Length, auth, Upgrade, Accept and
    // Transfer-Encoding already live in dedicated request members. Preserve
    // only the headers queried later by WebSocket, cache, SSE or CORS code.
    const bool retainHeader =
      name.equalsIgnoreCase("Sec-WebSocket-Version") ||
      name.equalsIgnoreCase("Sec-WebSocket-Key") ||
      name.equalsIgnoreCase("Sec-WebSocket-Protocol") ||
      name.equalsIgnoreCase("If-None-Match") ||
      name.equalsIgnoreCase("If-Modified-Since") ||
      name.equalsIgnoreCase("Last-Event-ID") ||
      name.equalsIgnoreCase("Origin");
    if (retainHeader) {
      _headers.emplace_back(std::move(header));
    }"""
    # The replacement itself contains ``_headers.emplace_back``. Check for the
    # complete patched form first; otherwise every PlatformIO invocation wraps
    # the already-patched line in another copy and produces a different image.
    if retain_needed in text:
        pass
    elif retain_all in text:
        text = text.replace(retain_all, retain_needed, 1)
    else:
        raise RuntimeError("ESPAsyncWebServer request-header retention changed; review dependency")
    with open(request_cpp, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def patch_async_webserver_default_response_headers(env):
    """Assemble protocol-owned response headers without STL list nodes.

    Accept-Ranges, Connection, Content-Length and Content-Type are properties
    of every response, not user-defined repeatable headers. Materializing them
    as list nodes at send time can terminate a heap-pressured Classic after the
    handler and middleware have already completed. Append them directly to the
    bounded header String while retaining explicit custom headers normally.
    """
    import os

    responses_cpp = os.path.join(
        env.subst("$PROJECT_LIBDEPS_DIR"), env["PIOENV"],
        "ESPAsyncWebServer", "src", "WebResponses.cpp")
    if not os.path.exists(responses_cpp):
        return
    with open(responses_cpp, "r", encoding="utf-8") as handle:
        text = handle.read()
    original = '''void AsyncWebServerResponse::_assembleHead(String &buffer, uint8_t version) {
  if (version) {
    addHeader(T_Accept_Ranges, T_none, false);
    if (_chunked) {
      addHeader(T_Transfer_Encoding, T_chunked, false);
    }
  }

  if (_sendContentLength) {
    addHeader(T_Content_Length, String(_contentLength), false);
  }

  if (_contentType.length()) {
    addHeader(T_Content_Type, _contentType.c_str(), false);
  }

  // precompute buffer size to avoid reallocations by String class
  size_t len = 0;
  len += 50;  // HTTP/1.1 200 <reason>\\r\\n
  for (const auto &header : _headers) {
    len += header.name().length() + header.value().length() + 4;
  }

  // prepare buffer
  buffer.reserve(len);

  // HTTP header
#ifdef ESP8266
  buffer.concat(PSTR("HTTP/1."));
#else
  buffer.concat("HTTP/1.");
#endif
  buffer.concat(version);
  buffer.concat(' ');
  buffer.concat(_code);
  buffer.concat(' ');
  buffer.concat(responseCodeToString(_code));
  buffer.concat(T_rn);

  // Add headers
  for (const auto &header : _headers) {
    buffer.concat(header.name());
#ifdef ESP8266
    buffer.concat(PSTR(": "));
#else
    buffer.concat(": ");
#endif
    buffer.concat(header.value());
    buffer.concat(T_rn);
  }

  buffer.concat(T_rn);
  _headLength = buffer.length();
}'''
    bounded = '''void AsyncWebServerResponse::_assembleHead(String &buffer, uint8_t version) {
  // Reserve once for the status line, explicit headers, and protocol-owned
  // defaults appended below without allocating std::list nodes.
  size_t len = 160;
  for (const auto &header : _headers) {
    len += header.name().length() + header.value().length() + 4;
  }
  buffer.reserve(len);

#ifdef ESP8266
  buffer.concat(PSTR("HTTP/1."));
#else
  buffer.concat("HTTP/1.");
#endif
  buffer.concat(version);
  buffer.concat(' ');
  buffer.concat(_code);
  buffer.concat(' ');
  buffer.concat(responseCodeToString(_code));
  buffer.concat(T_rn);

  for (const auto &header : _headers) {
    buffer.concat(header.name());
#ifdef ESP8266
    buffer.concat(PSTR(": "));
#else
    buffer.concat(": ");
#endif
    buffer.concat(header.value());
    buffer.concat(T_rn);
  }

  auto appendDefault = [&buffer, this](const char *name, const char *value) {
    if (getHeader(name)) return;
    buffer.concat(name);
    buffer.concat(": ");
    buffer.concat(value);
    buffer.concat(T_rn);
  };
  appendDefault(T_Connection, T_close);
  if (version) {
    appendDefault(T_Accept_Ranges, T_none);
    if (_chunked) appendDefault(T_Transfer_Encoding, T_chunked);
  }
  if (_sendContentLength) {
    char contentLength[24];
    snprintf(contentLength, sizeof(contentLength), "%u", (unsigned)_contentLength);
    appendDefault(T_Content_Length, contentLength);
  }
  if (_contentType.length()) appendDefault(T_Content_Type, _contentType.c_str());

  buffer.concat(T_rn);
  _headLength = buffer.length();
}'''
    if original in text:
        text = text.replace(original, bounded, 1)
    elif bounded not in text:
        raise RuntimeError("ESPAsyncWebServer response-head assembly changed; review dependency")
    # Connection is now a direct protocol default. Avoid allocating a list node
    # both in the basic constructor and late in abstract-response _respond().
    text = text.replace("  addHeader(T_Connection, T_close, false);\n", "", 2)
    with open(responses_cpp, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def patch_asynctcp_graceful_close(env):
    """Retry graceful FIN when lwIP temporarily rejects tcp_close().

    AsyncTCP 3.5.0 turns an ERR_MEM from tcp_close() into tcp_abort(), which
    truncates a response whose final bytes are still queued. Keep the PCB and
    callbacks alive instead; ESPAsyncWebServer retries close on the next ACK.
    """
    import os

    async_cpp = os.path.join(
        env.subst("$PROJECT_LIBDEPS_DIR"), env["PIOENV"], "AsyncTCP", "src", "AsyncTCP.cpp")
    if not os.path.exists(async_cpp):
        return
    with open(async_cpp, "r", encoding="utf-8") as handle:
        text = handle.read()
    throwing_close = """    _reset_tcp_callbacks(pcb, msg->close);
    if (tcp_close(pcb) != ERR_OK) {
      // We do not permit failure here: abandon the pcb anyways.
      tcp_abort(pcb);
    }
    msg->err = ERR_OK;
    *msg->pcb = nullptr;  // PCB is now the property of LwIP"""
    retrying_close = """    _reset_tcp_callbacks(pcb, msg->close);
    const err_t close_err = tcp_close(pcb);
    if (close_err != ERR_OK) {
      // ERR_MEM means queued response bytes still own lwIP segments. Restore
      // callbacks and retry on a later ACK instead of truncating via abort().
      _bind_tcp_callbacks(pcb, msg->close);
      msg->err = close_err;
      return msg->err;
    }
    msg->err = ERR_OK;
    *msg->pcb = nullptr;  // PCB is now the property of LwIP"""
    if throwing_close in text:
        text = text.replace(throwing_close, retrying_close, 1)
    elif retrying_close not in text:
        raise RuntimeError("AsyncTCP graceful close implementation changed; review dependency")
    with open(async_cpp, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def patch_async_webserver_stream_buffer(env):
    """Use one TCP MSS per concurrent streamed response.

    Cold browser loads request several gzip assets in parallel. Two MSS per
    response needlessly multiplies Classic peak heap; one MSS remains a normal
    TCP-sized write and materially lowers first-page memory pressure.
    """
    import os

    impl_header = os.path.join(
        env.subst("$PROJECT_LIBDEPS_DIR"), env["PIOENV"],
        "ESPAsyncWebServer", "src", "WebResponseImpl.h")
    if not os.path.exists(impl_header):
        return
    with open(impl_header, "r", encoding="utf-8") as handle:
        text = handle.read()
    oversized = "#define ASYNC_RESPONCE_BUFF_SIZE CONFIG_LWIP_TCP_MSS * 2"
    bounded = "#define ASYNC_RESPONCE_BUFF_SIZE CONFIG_LWIP_TCP_MSS"
    if oversized in text:
        text = text.replace(oversized, bounded, 1)
    elif bounded not in text:
        raise RuntimeError("ESPAsyncWebServer stream-buffer definition changed; review dependency")
    with open(impl_header, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def patch_async_webserver_final_stream_flush(env):
    """Do not mark a fixed-length stream finished while its last chunk is pending.

    Under normal Wi-Fi pressure AsyncClient may accept only part of the final
    file buffer. The pinned response code nevertheless changed state to END,
    so the request ACK handler gracefully closed before draining the remainder
    and browsers reported CONTENT_LENGTH_MISMATCH. Keeping RESPONSE_CONTENT
    lets the next ACK drain that buffer; the following zero-remaining pass then
    transitions to END through the existing code.
    """
    import os

    responses_cpp = os.path.join(
        env.subst("$PROJECT_LIBDEPS_DIR"), env["PIOENV"],
        "ESPAsyncWebServer", "src", "WebResponses.cpp")
    if not os.path.exists(responses_cpp):
        return
    with open(responses_cpp, "r", encoding="utf-8") as handle:
        text = handle.read()
    premature = '''          if (_sendContentLength && (_sentLength == _contentLength)) {
            // it was last piece of content
            _state = RESPONSE_END;
          }
'''
    bounded = '''          // Do not enter RESPONSE_END here: this newly filled buffer may
          // still be only partly accepted by AsyncClient. The next ACK drains
          // it, then the existing zero-remaining pass marks the response END.
'''
    if premature in text:
        text = text.replace(premature, bounded, 1)
    elif bounded not in text:
        raise RuntimeError("ESPAsyncWebServer final-stream state changed; review dependency")
    with open(responses_cpp, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


patch_async_webserver_request(env)
patch_async_webserver_accept(env)
patch_async_webserver_responses(env)
patch_async_webserver_header_retention(env)
patch_async_webserver_default_response_headers(env)
patch_asynctcp_graceful_close(env)
patch_async_webserver_stream_buffer(env)
patch_async_webserver_final_stream_flush(env)
