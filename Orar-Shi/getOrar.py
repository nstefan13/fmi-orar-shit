import time
import os
import sys
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

def downloadOrar(drive_url: str):
    download_dir = os.getcwd()

    options = webdriver.ChromeOptions()
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

    try:
        driver.get(drive_url)

        # JavaScript function to scroll the specific scrollable container inside Drive
        scroll_script = """
            function smoothScrollToBottom(element, duration = 1000) {
            const start = element.scrollTop;
            const target = element.scrollHeight - element.clientHeight;
            const distance = target - start;
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
                }
            }
            
            requestAnimationFrame(step);
            }
            
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
            smoothScrollToBottom(target, 15000); // 2000ms = 2 seconds
        """

        download_script =  """
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
            jspdf.onload = function () {
                // Generate a PDF from images with "blob:" sources.
                let pdf = new jsPDF();
                let elements = document.getElementsByTagName("img");
                for (let i = 0; i < elements.length; i++) {
                    let img = elements[i];
                    if (!/^blob:/.test(img.src)) {
                        continue;
                    }
                    let canvasElement = document.createElement('canvas');
                    let con = canvasElement.getContext("2d");
                    canvasElement.width = img.width;
                    canvasElement.height = img.height;
                    con.drawImage(img, 0, 0, img.width, img.height);
                    let imgData = canvasElement.toDataURL("image/jpeg", 1.0);
                    pdf.addImage(imgData, 'JPEG', 0, 0);
                    if (i !== elements.length - 1) {
                        pdf.addPage();
                    }
                }

                // Download the generated PDF.
                pdf.save("orar.pdf");
            };
            jspdf.src = trustedURL;
            document.body.appendChild(jspdf);
        """

        print("Scrolling through document pages")
        driver.execute_script(scroll_script)
        time.sleep(15)
        print("Downloading orar.pdf")
        driver.execute_script(download_script)
        time.sleep(5)

    finally:
            driver.quit()


downloadOrar(str(sys.argv[1]))