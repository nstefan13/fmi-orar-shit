import argparse
import base64
import logging
import os
import sys
import threading
import trio
from selenium import webdriver
from tqdm import tqdm
from tqdm.contrib.logging import logging_redirect_tqdm

log = logging.getLogger("drive_pdf")

BINDING_NAME = "sendImage"
SCROLL_AND_EXTRACT_JS = r"""
const callback = arguments[arguments.length - 1];

(async function () {
    try {
        const SELECTOR = 'img[src^="blob:https://drive.google.com/"]';
        const COUNTER_RE = /^\s*(?:\d+\s*)?(?:\/|of)\s*(\d+)\s*$/i;   // "1 / 45", "/ 45", "1 of 45"
        const MAX_INFLIGHT = 6;   // max canvases alive at once (caps browser RAM)
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        const started = new Set();   // srcs already encoding / sent
        const sent = new Set();      // srcs successfully sent to Python
        const inflight = new Set();  // running encode promises
        let sentCount = 0;
        let skipped = 0;
        let target = document.documentElement;   // scroll container (picked below)
        let exactTotal = 0;
        let lastTotalKey = "";

        const encode = (img) => new Promise((resolve, reject) => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                canvas.width = canvas.height = 0;   // free the canvas right away
                if (!blob) { reject(new Error("toBlob failed")); return; }
                const reader = new FileReader();
                reader.onloadend = () => {
                    const url = reader.result;
                    resolve(url.slice(url.indexOf(",") + 1));   // base64 only
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            }, "image/jpeg", __QUALITY__);
        });

        // Plain "I|n|src|base64" message: no JSON escaping of a multi-MB string
        const send = (src, data) => {
            sentCount++;
            sent.add(src);
            window.__BINDING__("I|" + sentCount + "|" + src + "|" + data);
        };

        // Start encoding images that are loaded and not seen yet (bounded)
        const scan = () => {
            for (const img of document.querySelectorAll(SELECTOR)) {
                if (inflight.size >= MAX_INFLIGHT) break;
                const src = img.src;
                if (started.has(src) || !img.complete || !img.naturalWidth || !img.naturalHeight) continue;
                started.add(src);
                const p = encode(img)
                    .then((data) => send(src, data))   // data is unreferenced after this
                    .catch((e) => { skipped++; console.error("encode failed", src, e); })
                    .finally(() => inflight.delete(p));
                inflight.add(p);
            }
        };

        // --- page count -------------------------------------------------------
        // 1) exact: the viewer's own page counter, a small text node like "1 / 45"
        const detectCounter = () => {
            for (const el of document.querySelectorAll("span, div")) {
                if (el.childElementCount !== 0) continue;
                const t = el.textContent;
                if (!t || t.length > 14) continue;
                const m = COUNTER_RE.exec(t);
                if (m) {
                    const v = parseInt(m[1], 10);
                    if (v > 0 && v < 10000) return v;
                }
            }
            return 0;
        };

        // 2) estimate: scrollable height / distance between two consecutive pages
        const estimateTotal = () => {
            const imgs = document.querySelectorAll(SELECTOR);
            if (imgs.length < 2) return 0;
            const pitch = Math.abs(
                imgs[1].getBoundingClientRect().top - imgs[0].getBoundingClientRect().top
            );
            if (pitch < 50) return 0;
            return Math.round(target.scrollHeight / pitch);
        };

        // Report the total only when it changes
        const reportTotal = () => {
            let kind = "exact";
            let total = exactTotal;
            if (!total) { exactTotal = detectCounter(); total = exactTotal; }
            if (!total) {
                kind = "est";
                total = Math.max(estimateTotal(), started.size);
            }
            if (!total) return;
            const key = kind + total;
            if (key === lastTotalKey) return;
            lastTotalKey = key;
            window.__BINDING__("T|" + kind + "|" + total);
        };

        // Watcher: runs concurrently with the scrolling
        let scrolling = true;
        let tick = 0;
        const watcher = (async () => {
            while (scrolling) {
                scan();
                if (tick++ % 10 === 0) {   // about every 500 ms
                    try { reportTotal(); } catch (e) { console.error("total detection failed", e); }
                }
                await sleep(50);
            }
        })();

        // Pick the tallest scrollable element in one pass.
        // getComputedStyle only runs for candidates that can beat the current best.
        let best = 0;
        for (const el of document.querySelectorAll("*")) {
            if (el.scrollHeight > el.clientHeight && el.scrollHeight > best) {
                const oy = getComputedStyle(el).overflowY;
                if (oy === "scroll" || oy === "auto") { best = el.scrollHeight; target = el; }
            }
        }

        // If the viewer says there are more pages than were captured, be more patient
        const stallLimit = () => (exactTotal && sent.size < exactTotal) ? 50 : 5;

        let lastScrollTop = -1;
        let lastStarted = -1;
        let unchangedCount = 0;

        while (unchangedCount < stallLimit()) {
            target.scrollTop += __STEP__;
            await sleep(10);

            // Stalled only if the scroll position AND the number of new images are unchanged
            if (target.scrollTop === lastScrollTop && started.size === lastStarted) {
                unchangedCount++;
            } else {
                unchangedCount = 0;
                lastScrollTop = target.scrollTop;
                lastStarted = started.size;
            }
        }

        // Scrolling finished: stop the watcher, then drain whatever is left
        scrolling = false;
        await watcher;
        while (true) {
            scan();
            if (inflight.size === 0) break;
            await Promise.race(Array.from(inflight));
        }

        // Final page order = current DOM order of the images that were sent
        const order = Array.from(document.querySelectorAll(SELECTOR), (img) => img.src)
            .filter((s) => sent.has(s));

        if (order.length === 0) {
            callback({ error: "No matching blob images found." });
            return;
        }

        const rawTitle = document.querySelector('meta[itemprop="name"]')?.content || document.title || "download";
        const filename = rawTitle.toLowerCase().endsWith(".pdf") ? rawTitle : `${rawTitle}.pdf`;

        callback({ filename, order, skipped });

    } catch (err) {
        console.error("JavaScript execution failed:", err);
        callback({ error: err.toString() });
    }
})();
"""


def _decode(n: int, b64: str) -> bytes:
    name = threading.current_thread().name
    log.debug(f"[{name}] Decoding image #{n}...")
    raw = base64.b64decode(b64)
    log.debug(f"[{name}] Finished image #{n} ({len(raw) // 1024} KiB)")
    return raw


async def _run(args: argparse.Namespace, driver) -> int:
    script = (
        SCROLL_AND_EXTRACT_JS
        .replace("__QUALITY__", str(args.quality))
        .replace("__STEP__", str(max(1, args.steps)))
        .replace("__BINDING__", BINDING_NAME)
    )

    results: dict[str, bytes] = {}
    state: dict = {"order": None, "exact": 0}
    ready = trio.Event()

    trio.to_thread.current_default_thread_limiter().total_tokens = os.cpu_count() or 4
    with logging_redirect_tqdm(), tqdm(total=None, unit="page", desc="Pages", dynamic_ncols=True) as bar:

        def check_ready():
            order = state["order"]
            if order is not None and all(src in results for src in order):
                ready.set()

        def set_total(kind: str, total: int):
            if kind == "exact":
                state["exact"] = total
            bar.total = total
            bar.set_description("Pages" if kind == "exact" else "Pages (est.)")

        async def decode_task(n: int, src: str, b64: str):
            log.debug(f"Image #{n} received, queued for processing")
            results[src] = await trio.to_thread.run_sync(_decode, n, b64)
            bar.update(1)
            bar.set_postfix_str(f"last: #{n} ({len(results[src]) // 1024} KiB)")
            check_ready()

        async with driver.bidi_connection() as connection:
            session, devtools = connection.session, connection.devtools

            await session.execute(devtools.runtime.enable())
            await session.execute(devtools.runtime.add_binding(BINDING_NAME))

            async with trio.open_nursery() as nursery:

                async def listener(task_status=trio.TASK_STATUS_IGNORED):
                    events = session.listen(devtools.runtime.BindingCalled, buffer_size=10000)
                    task_status.started()
                    async for event in events:
                        if event.name != BINDING_NAME:
                            continue
                        
                        kind, rest = event.payload.split("|", 1)
                        if kind == "I":
                            n, src, b64 = rest.split("|", 2)
                            nursery.start_soon(decode_task, int(n), src, b64)
                        elif kind == "T":
                            how, total = rest.split("|")
                            set_total(how, int(total))

                await nursery.start(listener)

                log.info("Scrolling and processing images at the same time...")
                result = await trio.to_thread.run_sync(driver.execute_async_script, script)

                log.debug("\n--- Browser Logs ---")
                for entry in driver.get_log("browser"):
                    log.debug(f"[{entry['level']}] {entry['message']}")
                log.debug("--------------------\n")

                if not result or "error" in result:
                    nursery.cancel_scope.cancel()
                    log.fatal(f"Failed to extract images: {result.get('error') if result else 'No response from script'}")
                    return 1

                order = result["order"]
                if result.get("skipped"):
                    log.warning(f"{result['skipped']} image(s) failed to encode and were skipped")

                bar.total = len(order)
                bar.set_description("Pages")

                state["order"] = order
                check_ready()
                with trio.fail_after(120):
                    await ready.wait()

                nursery.cancel_scope.cancel()

        exact = state["exact"]
        if exact and exact != len(order):
            log.warning(f"The viewer reports {exact} pages but {len(order)} were captured")

        image_bytes_list = [results[src] for src in order]
        log.debug(f"{len(results) - len(order)} superseded image(s) were dropped")
        results.clear()

        bar.n = len(order)
        bar.set_postfix_str("saving images")

        # -o is always treated as a directory now
        out_dir = args.output
        os.makedirs(out_dir, exist_ok=True)

        for i, img_bytes in enumerate(image_bytes_list, start=1):
            filepath = os.path.join(out_dir, f"{i}.jpeg")
            with open(filepath, "wb") as f:
                f.write(img_bytes)
        del image_bytes_list

        bar.set_postfix_str("saved")

    log.info(f"Successfully saved images to: {args.output} ({len(order)} pages)")
    return 0


def downloadFile(args: argparse.Namespace):
    options = webdriver.ChromeOptions()
    if args.headless:
        options.add_argument("--headless=new")
        options.add_argument("--window-size=2560,1600")
        options.add_argument("--force-device-scale-factor=2")
        options.add_argument("--high-dpi-support=1")

    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-background-timer-throttling")
    options.add_argument("--disable-renderer-backgrounding")
    options.add_argument("--disable-backgrounding-occluded-windows")
    options.add_argument("--disable-extensions")
    options.add_argument("--mute-audio")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})

    driver = webdriver.Chrome(options=options)

    driver.set_script_timeout(99999999999)

    try:
        driver.get(args.url)
        return trio.run(_run, args, driver)

    except Exception as e:
        log.fatal(f"An error occurred in Python execution: {e}")
        return 1

    finally:
        log.info("Closing Chrome browser...")
        driver.quit()


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Save a view only PDF from Google Drive.")
    p.add_argument("url", help="Google Drive file URL")
    p.add_argument("-o", "--output", default=".", help="output directory, or a full file path ending in .pdf (default: cwd)")
    p.add_argument("-q", "--quality", type=int, default=100, help="JPEG quality 1-100 (default 100)")
    p.add_argument("-s", "--steps", type=int, default=500, help="scrolling steps (default: 500)")
    p.add_argument("--headless", action="store_true", help="run Chrome headless")
    p.add_argument("-v", "--verbose", action="store_true", help="enable debug logs")
    args = p.parse_args(argv)

    if not 1 <= args.quality <= 100:
        p.error("--quality must be between 1 and 100")

    if args.steps <= 0:
        p.error("--steps must be positive")

    args.quality /= 100
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )
    try:
        return downloadFile(args)
    except KeyboardInterrupt:
        log.error("Interrupted")
        return 1


if __name__ == "__main__":
    sys.exit(main())