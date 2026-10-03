import time
import os
import sys
import base64
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

def downloadOrar(drive_url: str):
    download_dir = os.getcwd()

    options = webdriver.ChromeOptions()
    options.add_argument("--disable-web-security")
    options.add_argument("--allow-running-insecure-content")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    options.add_experimental_option("prefs", {
        "download.default_directory": download_dir,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "plugins.always_open_pdf_externally": True
    })

    driver = webdriver.Chrome(
        service=Service(ChromeDriverManager().install()), 
        options=options
    )
    driver.set_script_timeout(180)

    try:
        capture_blobs_script = """
            window.capturedBlobs = window.capturedBlobs || new Map();

            const originalCreateObjectURL = URL.createObjectURL;
            URL.createObjectURL = function (blob) {
                const url = originalCreateObjectURL.apply(this, arguments);
                window.capturedBlobs.set(url, blob);
                console.log("Captured blob: ", blob);
                return url;
            };
        """
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
            "source": capture_blobs_script
        })

        driver.get(drive_url)

        # JavaScript function to scroll the specific scrollable container inside Drive
        scroll_script = """
            const callback = arguments[arguments.length - 1];

            function smoothScrollToBottom(element, duration = 1000) {
                const start = element.scrollTop;
                const target = element.scrollHeight - element.clientHeight;
                const distance = target - start;
                if (distance <= 0) {
                    callback();
                    return;
                }
                const startTime = performance.now();
                
                function step(currentTime) {
                    const elapsed = currentTime - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    
                    // Ease-in-out quadratic function for natural movement
                    const ease = progress < 0.5 
                    ? 2 * progress * progress 
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                
                    element.scrollTop = start + distance * ease;
                
                    if (progress < 1) {
                        requestAnimationFrame(step);
                    } else {
                        callback();
                    }
                }
                
                requestAnimationFrame(step);
            }
            
            try {
                // 1. Find scrollable elements
                const scrollables = Array.from(document.querySelectorAll('*')).filter(el => {
                    const hasScrollableY = el.scrollHeight > el.clientHeight;
                    const overflowY = window.getComputedStyle(el).overflowY;
                    return hasScrollableY && (overflowY === 'scroll' || overflowY === 'auto');
                });
                
                // 2. Determine target container
                let target = document.documentElement;
                
                if (scrollables.length > 0) {
                    scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight);
                    target = scrollables[0];
                }
                
                // 3. Scroll to bottom with custom speed (Duration in milliseconds)
                // Lower number = faster, Higher number = slower
                smoothScrollToBottom(target, 30000);
            } catch (e) {
                console.error("Scroll error:", e);
                callback();
            }
        """

        download_script =  """
            const callback = arguments[arguments.length - 1];

            let trustedURL;
            if (window.trustedTypes && trustedTypes.createPolicy) {
                const policy = trustedTypes.createPolicy('myPolicy', {
                    createScriptURL: (input) => {
                        return input;
                    }
                });
                trustedURL = policy.createScriptURL('https://cdnjs.cloudflare.com/ajax/libs/jspdf/1.3.2/jspdf.min.js');
            } else {
                trustedURL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/1.3.2/jspdf.min.js';
            }

            // Load the jsPDF library using the trusted URL.
            let jspdf = document.createElement("script");
            jspdf.onload = async function () {
                try {
                    // Generate a PDF from images with "blob:" sources.
                    console.log("Download script started")
                    let blobs = [];
                    let elements = document.querySelectorAll('div[role="document"] img');

                    for (let i = 0; i < elements.length; i++) {
                        let src = elements[i].src;
                        if (!window.capturedBlobs || !window.capturedBlobs.has(src)) {
                            continue;
                        }

                        let blob = window.capturedBlobs.get(src);
                        let isImage = blob.type.startsWith('image/');
                        if (isImage) {
                            blobs.push(blob);
                        }
                    }

                    if (blobs.length === 0) {
                        callback(null);
                        return;
                    }
                    console.log(`Captured ${blobs.length} blobs`)
                    console.log("Creating the final PDF...")

                    let firstImg = await createImageBitmap(blobs[0]);
                    let pdf = new jsPDF({
                        orientation: firstImg.width > firstImg.height ? 'l' : 'p',
                        unit: 'px',
                        format: [firstImg.width, firstImg.height],
                        hotfixes: ['px_scaling']
                    });

                    for (let i = 0; i < blobs.length; i++) {
                        let img = (i === 0) ? firstImg : await createImageBitmap(blobs[i]);

                        if (i !== 0) {
                            pdf.addPage([img.width, img.height], img.width > img.height ? 'l' : 'p');
                        }

                        let canvasElement = document.createElement('canvas');
                        canvasElement.width = img.width;
                        canvasElement.height = img.height;
                        let con = canvasElement.getContext("2d");
                        con.drawImage(img, 0, 0);

                        // let imgData = canvasElement.toDataURL("image/png");
                        // pdf.addImage(imgData, 'PNG', 0, 0, img.width, img.height);
                        let imgData = canvasElement.toDataURL("image/jpeg", 0.95);
                        pdf.addImage(imgData, 'JPEG', 0, 0, img.width, img.height);
                    }

                    // Download the generated PDF.
                    console.log("Returning the PDF as a datauri string");
                    callback(pdf.output("datauristring"));
                } catch (e) {
                    console.log("⚠️ ERROR OCCURRED: ", e.message);
                    callback(`ERROR: ${e.message}`);
                }
            };
            jspdf.src = trustedURL;
            document.body.appendChild(jspdf);
        """

        print("Scrolling through document pages")
        driver.execute_async_script(scroll_script)

        print("Downloading orar.pdf")
        data_uri = driver.execute_async_script(download_script)
        if isinstance(data_uri, str) and data_uri.startswith("data:") and "," in data_uri:
            header, encoded = data_uri.split(",", 1)
            pdf_bytes = base64.b64decode(encoded)
            output_path = os.path.join(download_dir, "orar.pdf")
            with open(output_path, "wb") as f:
                f.write(pdf_bytes)
            print(f"Stored PDF in {output_path}")
        else:
            print("Error: data_uri is not a valid data URI:", data_uri)

        print("Browser logs:")
        for entry in driver.get_log("browser"):
            print(f"[{entry['level']}] {entry['message']}")

    finally:
            pass
            # driver.quit()


downloadOrar(str(sys.argv[1]))