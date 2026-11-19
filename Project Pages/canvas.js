
//      Canvas setup
//--------------------------
const canvas = document.getElementById("canvas");
canvas.width = .5*window.innerWidth;
canvas.height = .5*window.innerHeight;

const ctx = canvas.getContext("2d");

// Store the coordinates of the user's drawing
let points = [];

// Store the drawing as an image
let drawingImage = null;

// Track whether the user is currently drawing
let isDrawing = false;


// Convert browser coordinates to canvas coordinates
function getCanvasPosition(event) {
    const rect = canvas.getBoundingClientRect();

    return {
        x: (event.clientX - rect.left) * canvas.width / rect.width,
        y: (event.clientY - rect.top) * canvas.height / rect.height
    };
}


// 1. User presses down: clear the canvas and reset points
canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();

    // Clear the previous drawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Reset the points array
    points = [];

    // Reset the saved image
    drawingImage = null;

    // Start a new drawing
    isDrawing = true;

    // Get and record the initial position
    const pos = getCanvasPosition(event);
    points.push({
        x: pos.x,
        y: pos.y
    });
    
    // Start a new line
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    canvas.setPointerCapture(event.pointerId);
});


// 2. User drags: draw the line and record points
canvas.addEventListener("pointermove", (event) => {
    if (!isDrawing) return;

    // Get the current position
    const pos = getCanvasPosition(event);

    // Record the point
    points.push({
        x: pos.x,
        y: pos.y
    });

    // Draw the line
    ctx.lineTo(pos.x, pos.y);

    ctx.strokeStyle = "blue";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.stroke();
});


// 3. User releases: finish drawing and save the image
canvas.addEventListener("pointerup", (event) => {
    if (!isDrawing) return;

    isDrawing = false;

    // Finish the drawing path
    ctx.closePath();

    // Save the canvas image locally as a PNG data URL
    drawingImage = canvas.toDataURL("image/png");

    // Display the recorded data in the browser console
    console.log("Recorded points: ", points);
    console.log("Saved drawing image:", drawingImage);
});


// Handle interrupted pointer interactions
canvas.addEventListener("pointercancel", () => {
    isDrawing = false;
    ctx.closePath();
});



//      FOUIER STUFF
// ----------------------
// Convert an array of {x, y} points into uniformly spaced samples.
// The output length is always a power of 2.
function resamplePoints(inputPoints) {

    if (inputPoints.length < 2) {
        throw new Error("At least two drawing points are required.");
    }

    // Choose the largest power of 2 that does not exceed input length.
    const N = 2 ** Math.floor(Math.log2(inputPoints.length));

    // Calculate cumulative distances along the drawing.
    const distances = [0];

    for (let i = 1; i < inputPoints.length; i++) {

        const dx = inputPoints[i].x - inputPoints[i - 1].x;
        const dy = inputPoints[i].y - inputPoints[i - 1].y;

        distances.push(
            distances[i - 1] + Math.hypot(dx, dy)
        );
    }

    const totalLength = distances[distances.length - 1];

    if (totalLength === 0) {
        throw new Error("Drawing has no measurable length.");
    }

    const signal = [];

    // Sample at equally spaced distances.
    for (let i = 0; i < N; i++) {

        const target = (i / N) * totalLength;

        let j = 1;

        while (j < distances.length - 1 &&
               distances[j] < target) {
            j++;
        }

        const segmentLength = distances[j] - distances[j - 1];

        const ratio = segmentLength === 0
            ? 0
            : (target - distances[j - 1]) / segmentLength;

        const x =
            inputPoints[j - 1].x +
            ratio * (inputPoints[j].x - inputPoints[j - 1].x);

        const y =
            inputPoints[j - 1].y +
            ratio * (inputPoints[j].y - inputPoints[j - 1].y);

        // Convert canvas coordinates into complex coordinates.
        signal.push([
            x - canvas.width / 2,
            canvas.height / 2 - y
        ]);
    }

    return signal;
}


// Iterative Cooley-Tukey FFT.
// Input: [[real, imaginary], ...]
function fft(signal) {

    const N = signal.length;

    if (N === 0 || (N & (N - 1)) !== 0) {
        throw new Error("FFT input length must be a power of 2.");
    }

    // Copy the input.
    const output = signal.map(([re, im]) => [re, im]);

    // Bit reversal permutation.
    let j = 0;

    for (let i = 1; i < N; i++) {

        let bit = N >> 1;

        while (j & bit) {
            j ^= bit;
            bit >>= 1;
        }

        j ^= bit;

        if (i < j) {
            [output[i], output[j]] = [output[j], output[i]];
        }
    }

    // FFT butterfly operations.
    for (let size = 2; size <= N; size *= 2) {

        const half = size / 2;
        const angle = -2 * Math.PI / size;

        const wReal = Math.cos(angle);
        const wImag = Math.sin(angle);

        for (let start = 0; start < N; start += size) {

            let wr = 1;
            let wi = 0;

            for (let k = 0; k < half; k++) {

                const even = output[start + k];
                const odd = output[start + k + half];

                // Complex multiplication.
                const tr = wr * odd[0] - wi * odd[1];
                const ti = wr * odd[1] + wi * odd[0];

                // Save original even values.
                const er = even[0];
                const ei = even[1];

                // Butterfly.
                output[start + k] = [
                    er + tr,
                    ei + ti
                ];

                output[start + k + half] = [
                    er - tr,
                    ei - ti
                ];

                // Update twiddle factor.
                const nextWr = wr * wReal - wi * wImag;
                const nextWi = wr * wImag + wi * wReal;

                wr = nextWr;
                wi = nextWi;
            }
        }
    }

    return output;
}


// Convert Fourier coefficients into magnitude and phase.
function pre_ift(ft) {

    const mag = [];
    const phase = [];

    for (let i = 0; i < ft.length; i++) {

        const re = ft[i][0];
        const im = ft[i][1];

        mag.push(Math.hypot(re, im));
        phase.push(Math.atan2(im, re));
    }

    return {
        mag: mag,
        phase: phase
    };
}


// Complete Fourier transform.
function ftt_full(signal) {

    const ft = fft(signal);

    return pre_ift(ft);
}


// Reconstruct the signal using rotating Fourier vectors.
//
// mp: magnitude/phase object
// depth: number of Fourier coefficients to use
// t: time parameter between 0 and 1
//
// Returns cumulative vector endpoints.
function reconstruct_signal(mp, depth, t) {

    const N = mp.mag.length;

    if (N === 0) return [];

    const coefficients = [];

    // Create coefficients and preserve signed frequencies.
    for (let i = 0; i < N; i++) {

        const frequency = i <= Math.floor(N / 2)
            ? i
            : i - N;

        coefficients.push({

            mag: mp.mag[i] / N,
            phase: mp.phase[i],
            freq: frequency

        });
    }

    // Sort by absolute frequency (lowest first).
    coefficients.sort((a, b) =>
        Math.abs(a.freq) - Math.abs(b.freq)
    );

    depth = Math.min(depth, N);

    const reconstruction = [];

    let x = 0;
    let y = 0;

    for (let i = 0; i < depth; i++) {

        const coefficient = coefficients[i];

        const magnitude = coefficient.mag;
        const phase = coefficient.phase;
        const frequency = coefficient.freq;

        const angle =
            2 * Math.PI * frequency * t + phase;

        const vx = magnitude * Math.cos(angle);
        const vy = magnitude * Math.sin(angle);

        x += vx;
        y += vy;

        reconstruction.push({

            mag: magnitude,
            freq: frequency,
            phase: phase,

            vx: vx,
            vy: vy,

            x: x,
            y: y
        });
    }

    return reconstruction;
}



// Front facing Fouier Transform stuff.
// This is very basic usage.
const button = document.getElementById("FouierTransform");

button.onclick = function() {

    // If already processed, stop and reset.
    if (signalInfo.processed) {

        signalInfo.reset();

        if (animationId !== null) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }

        animationCtx.clearRect(
            0, 0,
            animationCanvas.width,
            animationCanvas.height
        );

        return;
    }

    // Check whether a drawing exists.
    if (points.length < 2) {
        alert("Draw something first!");
        return;
    }
    
    const signal = resamplePoints(points);
    const ft = fft(signal);
    const mp = pre_ift(ft);
    signalInfo.update(signal, ft);

    // Start animation.
    animateFourier(mp);
};



//      Animation Cavnas
// ---------------------------
const animationCanvas = document.getElementById("animationCanvas");
const animationCtx = animationCanvas.getContext("2d");

// Make the animation canvas the same size as the drawing canvas.
animationCanvas.width = canvas.width;
animationCanvas.height = canvas.height;

// Match the displayed dimensions as well.
animationCanvas.style.width = canvas.offsetWidth + "px";
animationCanvas.style.height = canvas.offsetHeight + "px";

let animationId = null;



function animateFourier(mp) {

    const N = mp.mag.length;

    if (N === 0) return;

    // Stop any previous animation.
    if (animationId !== null) {
        cancelAnimationFrame(animationId);
    }

    const duration = 5000;

    let startTime = null;

    // Store the reconstructed curve.
    const path = [];

    // Center of the animation canvas.
    const centerX = animationCanvas.width / 2;
    const centerY = animationCanvas.height / 2;

    // Scale factor for the reconstruction.
    const scale = 1;

    function drawFrame(timestamp) {

        if (startTime === null) {
            startTime = timestamp;
        }

        const elapsed = timestamp - startTime;

        // Animation progress between 0 and 1.
        const progress = (elapsed % duration) / duration;

        // Time parameter for Fourier reconstruction.
        const t = progress;

        // Clear canvas.
        animationCtx.clearRect(
            0,
            0,
            animationCanvas.width,
            animationCanvas.height
        );

        // Get the positions of all Fourier vectors.
        const reconstruction = reconstruct_signal(
            mp,
            N,
            t
        );

        // Starting position of the first vector.
        let startX = centerX;
        let startY = centerY;

        // Draw all Fourier circles and vectors.
        for (let i = 0; i < reconstruction.length; i++) {

            const vector = reconstruction[i];

            const endX = centerX + vector.x * scale;
            const endY = centerY - vector.y * scale;

            const radius = vector.mag * scale;

            // Draw the circle representing this Fourier component.
            animationCtx.beginPath();

            animationCtx.arc(
                startX,
                startY,
                radius,
                0,
                2 * Math.PI
            );

            animationCtx.strokeStyle = "rgba(150, 150, 150, 0.5)";
            animationCtx.lineWidth = 1;

            animationCtx.stroke();

            // Draw the rotating vector.
            animationCtx.beginPath();

            animationCtx.moveTo(startX, startY);
            animationCtx.lineTo(endX, endY);

            animationCtx.strokeStyle = "red";
            animationCtx.lineWidth = 2;

            animationCtx.stroke();

            // Draw the endpoint.
            animationCtx.beginPath();

            animationCtx.arc(
                endX,
                endY,
                2,
                0,
                2 * Math.PI
            );

            animationCtx.fillStyle = "black";
            animationCtx.fill();

            // The next vector starts where this one ends.
            startX = endX;
            startY = endY;
        }

        // Final endpoint of the Fourier reconstruction.
        const finalX = startX;
        const finalY = startY;

        // Save the reconstructed point.
        path.push({
            x: finalX,
            y: finalY
        });

        // Draw the reconstructed curve.
        animationCtx.beginPath();

        if (path.length > 0) {

            animationCtx.moveTo(
                path[0].x,
                path[0].y
            );

            for (let i = 1; i < path.length; i++) {

                animationCtx.lineTo(
                    path[i].x,
                    path[i].y
                );
            }
        }

        animationCtx.strokeStyle = "blue";
        animationCtx.lineWidth = 2;
        animationCtx.lineCap = "round";
        animationCtx.lineJoin = "round";

        animationCtx.stroke();

        // Draw the final endpoint.
        animationCtx.beginPath();

        animationCtx.arc(
            finalX,
            finalY,
            3,
            0,
            2 * Math.PI
        );

        animationCtx.fillStyle = "blue";
        animationCtx.fill();

        // Continue animation.
        animationId = requestAnimationFrame(drawFrame);
    }

    animationId = requestAnimationFrame(drawFrame);
}








const signalInfo = {
    size: 0,
    processed: false,
    coefficients: 0,

    update: function(signal, ft) {
        this.size = signal.length;
        this.coefficients = ft.length;
        this.processed = true;

        console.log("Signal processed!");
        console.log("Signal size:", this.size);
        console.log("Fourier coefficients:", this.coefficients);
    },

    reset: function() {
        this.size = 0;
        this.coefficients = 0;
        this.processed = false;
    }
};

