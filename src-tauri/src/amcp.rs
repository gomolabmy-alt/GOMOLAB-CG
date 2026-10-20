// AMCP-style CG control port — a pragmatic subset of CasparCG's `CG`
// command family (ADD/PLAY/STOP/UPDATE/REMOVE/CLEAR), enough for scripting
// or automation to drive this app's own CasparCG-style channel/layer
// playout (see src/stores/cgPlayoutStore.ts) over a plain TCP connection.
// This is NOT full AMCP/OSC protocol compliance — no INFO/CLS/TLS/version
// handshake, just the command grammar documented below and single-line
// numeric-style replies.
//
// Grammar (case-insensitive verbs, `{channel}-{layer}` addresses a layer):
//   CG {channel}-{layer} ADD "{template}" {0|1} [{json}]   — load a template,
//       playing it immediately if the flag is 1. {template} is matched
//       against a widget's label (falling back to its id) — resolved
//       CLIENT-SIDE in cgPlayoutStore.ts's initPlayoutSync(), never here:
//       this module has no visibility into canvas widgets and shouldn't be
//       taught the domain model just to look up a name. That also means ADD
//       replies "202 CG OK" optimistically even for a name that turns out
//       not to resolve to anything — a deliberate, documented trade-off.
//   CG {channel}-{layer} PLAY                              — play a loaded layer
//   CG {channel}-{layer} STOP                               — stop (out-transition, then clear)
//   CG {channel}-{layer} UPDATE {json}                      — merge live data into the on-air instance
//   CG {channel}-{layer} REMOVE | CLEAR                     — clear immediately
//   PLAY|STOP|CLEAR {channel}-{layer}                       — bare aliases of the three above
//
// Each parsed command is translated into the exact JSON a browser-side
// caller would send — {"type":"ACTION","store":"playout","fn":...,"args":[...]}
// — and fanned out via server::relay_action, the same three-destination
// relay (readonly clients, commentator clients, every interactive client
// including the host) handle_interactive_ws's own "ACTION" case already
// uses. The host then applies it to real state through the normal
// initPlayoutSync() dispatch, indistinguishable from a local UI action.

use crate::server::{relay_action, ServerState};
use serde_json::json;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

pub async fn start_amcp_server(state: Arc<ServerState>) {
    let port = state.amcp_port;
    let listener = match TcpListener::bind(format!("0.0.0.0:{port}")).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("AMCP: failed to bind port {port}: {e}");
            return;
        }
    };
    println!("AMCP:         tcp://{}:{}", state.lan_ip, port);

    loop {
        let Ok((stream, _addr)) = listener.accept().await else { continue };
        if !*state.amcp_enabled.read().await {
            // Disabled — drop immediately rather than accepting a connection
            // this port isn't currently meant to serve. Toggling AMCP back
            // on only affects new connections accepted after that point, not
            // a retroactive close of anything (there's nothing to close —
            // this branch never got past accept()).
            continue;
        }
        let state = Arc::clone(&state);
        tokio::spawn(handle_conn(stream, state));
    }
}

async fn handle_conn(stream: tokio::net::TcpStream, state: Arc<ServerState>) {
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break, // peer closed
            Ok(_) => {
                let reply = handle_line(&state, line.trim_end_matches(['\r', '\n'])).await;
                if write_half.write_all(format!("{reply}\r\n").as_bytes()).await.is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

async fn handle_line(state: &Arc<ServerState>, line: &str) -> &'static str {
    let line = line.trim();
    if line.is_empty() {
        return "500 FAILED";
    }

    let mut top = line.splitn(2, ' ');
    let verb = top.next().unwrap_or("").to_ascii_uppercase();
    let rest = top.next().unwrap_or("").trim();

    match verb.as_str() {
        "CG" => handle_cg(state, rest).await,
        "PLAY" | "STOP" | "CLEAR" => {
            let Some((channel, layer)) = parse_addr(rest) else { return "500 FAILED" };
            let fn_name = match verb.as_str() {
                "PLAY" => "playLayer",
                "STOP" => "stopLayer",
                _ => "clearLayer",
            };
            send_action(state, fn_name, json!([channel, layer])).await;
            "202 CG OK"
        }
        _ => "500 FAILED",
    }
}

async fn handle_cg(state: &Arc<ServerState>, rest: &str) -> &'static str {
    let mut it = rest.splitn(2, ' ');
    let Some((channel, layer)) = it.next().and_then(parse_addr) else { return "500 FAILED" };
    let rest2 = it.next().unwrap_or("").trim();

    let mut it2 = rest2.splitn(2, ' ');
    let subverb = it2.next().unwrap_or("").to_ascii_uppercase();
    let rest3 = it2.next().unwrap_or("").trim();

    match subverb.as_str() {
        "ADD" => {
            let Some((template, remainder)) = take_quoted(rest3) else { return "500 FAILED" };
            let mut it3 = remainder.trim_start().splitn(2, ' ');
            let play_on_load = it3.next().unwrap_or("0").trim() == "1";
            let json_str = it3.next().unwrap_or("").trim();
            let data_patch = if json_str.is_empty() {
                json!({})
            } else {
                match serde_json::from_str::<serde_json::Value>(json_str) {
                    Ok(v) => v,
                    Err(_) => return "500 FAILED",
                }
            };
            send_action(
                state,
                "loadLayer",
                json!([channel, layer, template, { "playOnLoad": play_on_load, "dataPatch": data_patch }]),
            )
            .await;
            "202 CG OK"
        }
        "PLAY" => { send_action(state, "playLayer", json!([channel, layer])).await; "202 CG OK" }
        "STOP" => { send_action(state, "stopLayer", json!([channel, layer])).await; "202 CG OK" }
        "UPDATE" => {
            if rest3.is_empty() {
                return "500 FAILED";
            }
            let data_patch = match serde_json::from_str::<serde_json::Value>(rest3) {
                Ok(v) => v,
                Err(_) => return "500 FAILED",
            };
            send_action(state, "updateLayer", json!([channel, layer, data_patch])).await;
            "202 CG OK"
        }
        "REMOVE" | "CLEAR" => { send_action(state, "clearLayer", json!([channel, layer])).await; "201 CG OK" }
        _ => "500 FAILED",
    }
}

async fn send_action(state: &Arc<ServerState>, fn_name: &str, args: serde_json::Value) {
    let text = json!({ "type": "ACTION", "store": "playout", "fn": fn_name, "args": args }).to_string();
    relay_action(state, &text, None).await;
}

/// Parses a "{channel}-{layer}" address, e.g. "1-10" -> (1, 10).
fn parse_addr(s: &str) -> Option<(u32, u32)> {
    let s = s.trim();
    let (a, b) = s.split_once('-')?;
    Some((a.trim().parse().ok()?, b.trim().parse().ok()?))
}

/// Takes a leading `"quoted string"` off `s`, returning (content, remainder).
fn take_quoted(s: &str) -> Option<(String, &str)> {
    let s = s.trim_start();
    let rest = s.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some((rest[..end].to_string(), rest[end + 1..].trim_start()))
}
