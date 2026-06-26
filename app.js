document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const sections = document.querySelectorAll('.parallax-section');
    const layers = document.querySelectorAll('.layer');
    const depthSub = document.getElementById('depthSub');
    const depthDigital = document.getElementById('depthDigital');
    const navDots = document.querySelectorAll('.nav-dot');
    const soundToggle = document.querySelector('.sound-toggle');
    const iconSoundOn = document.querySelector('.icon-sound-on');
    const iconSoundOff = document.querySelector('.icon-sound-off');
    const cursorBubbles = document.getElementById('cursorBubbles');
    const biolumParticlesContainer = document.getElementById('biolumParticles');

    // State Variables
    let scrollY = window.scrollY;
    let windowHeight = window.innerHeight;
    let maxScroll = document.documentElement.scrollHeight - windowHeight;
    let isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let isMobile = window.innerWidth <= 768;

    // Track state for audio synthesis
    let audioCtx = null;
    let isAudioPlaying = false;
    let ambientHumNode = null;
    let filterNode = null;
    let masterGainNode = null;
    let sonarInterval = null;
    let bubbleSoundTimeout = null;
    let currentActiveZone = 0;

    // 1. UPDATE DIMENSIONS ON RESIZE
    window.addEventListener('resize', () => {
        windowHeight = window.innerHeight;
        maxScroll = document.documentElement.scrollHeight - windowHeight;
        isMobile = window.innerWidth <= 768;
    });

    // 2. PARALLAX SCROLL MATH (Using requestAnimationFrame)
    let tick = false;
    
    function updateParallax() {
        scrollY = window.scrollY;

        // Skip parallax if mobile or reduced motion is preferred
        if (!isReducedMotion && !isMobile) {
            sections.forEach((section, index) => {
                const sectionTop = index * windowHeight;
                const sectionBottom = sectionTop + windowHeight;

                // Check if section is inside viewport buffer
                if (scrollY >= sectionTop - windowHeight && scrollY <= sectionBottom) {
                    const localScroll = scrollY - sectionTop;
                    
                    // Calculate how centered this section is (0 when off-screen, 1 when centered)
                    const sectionCenter = sectionTop + windowHeight / 2;
                    const viewportCenter = scrollY + windowHeight / 2;
                    const distanceFromCenter = Math.abs(viewportCenter - sectionCenter);
                    
                    // activeRatio is 1 when perfectly centered, decaying to 0 when scrolled away
                    const activeRatio = Math.max(0, Math.min(1, 1 - (distanceFromCenter / windowHeight)));
                    
                    const sectionLayers = section.querySelectorAll('.layer');
                    
                    sectionLayers.forEach(layer => {
                        const speed = parseFloat(layer.getAttribute('data-speed'));
                        // Formula: translateY = localScroll * (1 - speed)
                        const translateY = localScroll * (1 - speed);
                        
                        // Active zoom: Layers scale up slightly (0.95 to 1) as they align with the center
                        const scale = 0.95 + (0.05 * activeRatio);
                        
                        // Active fade: Background fades to absolute black as it departs, 
                        // producing a smooth cinematic vignette transition between zones
                        const opacity = Math.min(1, activeRatio * 1.5);
                        
                        // Apply transforms using translate3d & scale for GPU acceleration
                        layer.style.transform = `translate3d(0, ${translateY}px, 0) scale(${scale})`;
                        layer.style.opacity = opacity;
                    });
                }
            });
        }

        // 3. DEPTH GAUGE & INDICATOR UPDATE
        const scrollPercent = Math.max(0, Math.min(1, scrollY / maxScroll));
        
        // Update submarine position (percentage along vertical gauge track)
        depthSub.style.top = `calc(${scrollPercent * 90}% + 5%)`;
        
        // Update digital depth numbers (0m to 11000m)
        const depthVal = Math.round(scrollPercent * 11000);
        depthDigital.textContent = depthVal.toLocaleString() + 'm';

        // Rotate submarine propeller slightly when scrolling
        const subSvg = depthSub.querySelector('svg');
        if (subSvg) {
            subSvg.style.transform = `scale(${1 + Math.sin(scrollY * 0.05) * 0.05})`;
        }

        // 4. GENERATE SOUND EFFECTS REACTIVE TO SCROLL SPEED
        if (isAudioPlaying && audioCtx && Math.abs(lastScrollY - scrollY) > 5) {
            triggerBubbleSynth();
        }
        lastScrollY = scrollY;

        tick = false;
    }

    let lastScrollY = window.scrollY;

    window.addEventListener('scroll', () => {
        if (!tick) {
            window.requestAnimationFrame(updateParallax);
            tick = true;
        }
    });

    // 5. INTERSECTION OBSERVER FOR TEXT ANIMATIONS & ACTIVE NAVIGATION
    const observerOptions = {
        threshold: 0.4 // Trigger when 40% of the section is visible
    };

    // Bubble Wipe Transition Effect between depth zones
    function triggerZoneBubbleWipe() {
        const container = document.getElementById('cursorBubbles');
        if (!container || isMobile || isReducedMotion) return;

        const bubbleCount = 22;
        for (let i = 0; i < bubbleCount; i++) {
            const bubble = document.createElement('div');
            bubble.classList.add('transition-bubble');
            
            const size = 15 + Math.random() * 35; // Large screen-wipe bubble sizes
            bubble.style.width = `${size}px`;
            bubble.style.height = `${size}px`;
            bubble.style.left = `${Math.random() * 100}vw`;
            bubble.style.bottom = `-60px`;
            bubble.style.top = 'auto'; // Disable absolute cursor top coordinate
            
            const duration = 1.6 + Math.random() * 1.6;
            bubble.style.animation = `bubbleWipeRise ${duration}s cubic-bezier(0.25, 1, 0.5, 1) forwards`;
            bubble.style.animationDelay = `${Math.random() * 0.4}s`;
            
            container.appendChild(bubble);
            
            setTimeout(() => {
                bubble.remove();
            }, (duration + 0.5) * 1000);
        }
    }

    const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const index = entry.target.getAttribute('data-index');
            const content = entry.target.querySelector('.section-content');

            if (entry.isIntersecting) {
                // Add visible class to trigger transitions
                if (content) content.classList.add('visible');
                
                // Trigger bubble screen sweep when zone index changes
                const zoneIndex = parseInt(index);
                if (zoneIndex !== currentActiveZone) {
                    currentActiveZone = zoneIndex;
                    triggerZoneBubbleWipe();
                }
                
                // Update navigation dots
                navDots.forEach(dot => dot.classList.remove('active'));
                const activeDot = document.querySelector(`.nav-dot[data-index="${index}"]`);
                if (activeDot) activeDot.classList.add('active');

                // Adjust audio parameters dynamically based on depth zone
                if (isAudioPlaying && filterNode && masterGainNode) {
                    // Lower depth -> Lower cutoff frequency for a more muffled, deep feeling
                    const cutoffs = [220, 180, 140, 100, 70];
                    filterNode.frequency.exponentialRampToValueAtTime(cutoffs[index], audioCtx.currentTime + 1.5);
                    
                    // Surface volume is very low (0.012), volume scales up as you descend into deep pressure (up to 0.065)
                    const volumes = [0.012, 0.024, 0.038, 0.052, 0.065];
                    masterGainNode.gain.exponentialRampToValueAtTime(volumes[index], audioCtx.currentTime + 1.5);
                }
            } else {
                // Remove visible class when leaving to allow re-animation on scroll
                if (content) content.classList.remove('visible');
            }
        });
    }, observerOptions);

    sections.forEach(section => sectionObserver.observe(section));

    // 6. GENERATE BACKGROUND ANIMATION PARTICLES FOR ALL ZONES
    
    // A. Sunlight Zone: Ambient Rising Bubbles
    function initSunlightBubbles() {
        const container = document.getElementById('sunlightBubbles');
        if (!container) return;
        const count = 18;
        for (let i = 0; i < count; i++) {
            const bubble = document.createElement('div');
            bubble.classList.add('bg-bubble');
            bubble.style.left = `${Math.random() * 100}%`;
            bubble.style.bottom = `-${10 + Math.random() * 30}px`;
            const size = 3 + Math.random() * 10;
            bubble.style.width = `${size}px`;
            bubble.style.height = `${size}px`;
            bubble.style.animationDelay = `${Math.random() * 10}s`;
            bubble.style.animationDuration = `${7 + Math.random() * 8}s`;
            container.appendChild(bubble);
        }
    }

    // B. Twilight Zone: Drifting Organic Marine Snow Flakes
    function initTwilightSnow() {
        const container = document.getElementById('twilightSnow');
        if (!container) return;
        const count = 28;
        for (let i = 0; i < count; i++) {
            const flake = document.createElement('div');
            flake.classList.add('marine-flake');
            flake.style.left = `${Math.random() * 100}%`;
            flake.style.top = `${Math.random() * 100}%`;
            const size = 1.5 + Math.random() * 3.5;
            flake.style.width = `${size}px`;
            flake.style.height = `${size}px`;
            flake.style.animationDelay = `${Math.random() * 12}s`;
            flake.style.animationDuration = `${12 + Math.random() * 16}s`;
            container.appendChild(flake);
        }
    }

    // C. Midnight Zone: Bioluminescent Spark Particles
    function initBiolum() {
        if (!biolumParticlesContainer) return;
        const particleCount = 25;
        for (let i = 0; i < particleCount; i++) {
            const spark = document.createElement('div');
            spark.classList.add('biolum-spark');
            
            spark.style.left = `${Math.random() * 100}%`;
            spark.style.top = `${Math.random() * 100}%`;
            spark.style.animationDelay = `${Math.random() * 8}s`;
            spark.style.animationDuration = `${3 + Math.random() * 5}s`;
            
            const scale = 0.5 + Math.random() * 1.5;
            spark.style.transform = `scale(${scale})`;
            
            const colors = ['#00f3ff', '#00ffaa', '#ff007f', '#b5179e'];
            const chosenColor = colors[Math.floor(Math.random() * colors.length)];
            spark.style.background = chosenColor;
            spark.style.boxShadow = `0 0 12px ${chosenColor}`;

            biolumParticlesContainer.appendChild(spark);
        }
    }

    // D. Hadal Trench: Glowing Tectonic Dust
    function initHadalDust() {
        const container = document.getElementById('hadalDust');
        if (!container) return;
        const count = 20;
        for (let i = 0; i < count; i++) {
            const speck = document.createElement('div');
            speck.classList.add('hadal-speck');
            speck.style.left = `${Math.random() * 100}%`;
            speck.style.top = `${Math.random() * 100}%`;
            const size = 2 + Math.random() * 4;
            speck.style.width = `${size}px`;
            speck.style.height = `${size}px`;
            speck.style.animationDelay = `${Math.random() * 8}s`;
            speck.style.animationDuration = `${5 + Math.random() * 8}s`;
            
            const colors = ['#00f3ff', '#ffab00', '#ff0055'];
            const chosenColor = colors[Math.floor(Math.random() * colors.length)];
            speck.style.background = chosenColor;
            speck.style.boxShadow = `0 0 10px ${chosenColor}`;
            container.appendChild(speck);
        }
    }

    // Initialize all background particle animations
    initSunlightBubbles();
    initTwilightSnow();
    initBiolum();
    initHadalDust();

    // 7. DYNAMIC HYDROTHERMAL SMOKE PUFFS (Midnight Zone)
    function createSmokePuff(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const puff = document.createElement('div');
        puff.classList.add('smoke-puff');
        
        // Randomize size and horizontal drift slightly
        const size = 15 + Math.random() * 30;
        puff.style.width = `${size}px`;
        puff.style.height = `${size}px`;
        puff.style.left = `${-size / 2 + (Math.random() - 0.5) * 20}px`;

        container.appendChild(puff);

        // Remove element after animation finishes
        setTimeout(() => {
            puff.remove();
        }, 5000);
    }

    // Emit smoke particles from vents periodically
    setInterval(() => createSmokePuff('smokeLeft'), 600);
    setInterval(() => createSmokePuff('smokeRight'), 800);

    // 8. CURSOR FOLLOW BUBBLES TRAIL (Desktop only)
    let lastBubbleTime = 0;
    document.addEventListener('mousemove', (e) => {
        if (isMobile || isReducedMotion) return;
        
        const now = Date.now();
        if (now - lastBubbleTime > 120) { // Throttle particle creation
            createCursorBubble(e.clientX, e.clientY);
            lastBubbleTime = now;
        }
    });

    function createCursorBubble(x, y) {
        const bubble = document.createElement('div');
        bubble.classList.add('cursor-bubble');
        
        const size = 5 + Math.random() * 12;
        bubble.style.width = `${size}px`;
        bubble.style.height = `${size}px`;
        bubble.style.left = `${x}px`;
        bubble.style.top = `${y}px`;
        
        cursorBubbles.appendChild(bubble);
        
        setTimeout(() => {
            bubble.remove();
        }, 2500);
    }

    // 9. WEB AUDIO API SYNTHESIZER (Immersive Deep Ocean Ambient Synth)
    function initAudio() {
        // Create browser audio context
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();

        // A. Generate Dark Brown Noise (Softer, lower-pitched than pink noise, representing water flow)
        const bufferSize = 2 * audioCtx.sampleRate;
        const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            // Brown noise formula (accumulated random walk filter)
            output[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = output[i];
            output[i] *= 3.0; // Normalise volume
        }

        const noiseSource = audioCtx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        // B. Deep Ambient Sine Wave Swells (Sub-bass drone)
        const subOsc1 = audioCtx.createOscillator();
        const subOsc2 = audioCtx.createOscillator();
        subOsc1.type = 'sine';
        subOsc2.type = 'sine';
        subOsc1.frequency.value = 50;  // G0 note (deep sub bass)
        subOsc2.frequency.value = 75;  // D1 note (perfect fifth, warm resonance)

        const subGain1 = audioCtx.createGain();
        const subGain2 = audioCtx.createGain();
        subGain1.gain.value = 0.015;
        subGain2.gain.value = 0.01;

        // Modulate volume using slow low-frequency oscillators (LFO) for breathing ocean currents
        const lfo1 = audioCtx.createOscillator();
        const lfo2 = audioCtx.createOscillator();
        lfo1.type = 'sine';
        lfo2.type = 'sine';
        lfo1.frequency.value = 0.06; // Swell period ~16s
        lfo2.frequency.value = 0.04; // Swell period ~25s

        const lfoGain1 = audioCtx.createGain();
        const lfoGain2 = audioCtx.createGain();
        lfoGain1.gain.value = 0.008;
        lfoGain2.gain.value = 0.005;

        // Connect LFOs to modulate gain values
        lfo1.connect(lfoGain1);
        lfoGain1.connect(subGain1.gain);
        lfo2.connect(lfoGain2);
        lfoGain2.connect(subGain2.gain);

        // Lowpass Filter for ocean damping
        filterNode = audioCtx.createBiquadFilter();
        filterNode.type = 'lowpass';
        filterNode.frequency.value = 220; // Lower starting frequency to keep it soft and muffled

        // Master Gain Node (low base volume)
        masterGainNode = audioCtx.createGain();
        masterGainNode.gain.setValueAtTime(0.012, audioCtx.currentTime); // Very soft starting volume (0.012)

        // Connections
        noiseSource.connect(filterNode);
        
        subOsc1.connect(subGain1);
        subOsc2.connect(subGain2);
        subGain1.connect(filterNode);
        subGain2.connect(filterNode);

        filterNode.connect(masterGainNode);
        masterGainNode.connect(audioCtx.destination);

        // Start Oscillators and Noise
        noiseSource.start();
        subOsc1.start();
        subOsc2.start();
        lfo1.start();
        lfo2.start();

        // Keep references for adjustments on scroll
        ambientHumNode = noiseSource;

        // C. Periodic Sonar Pings (Warm G-chord notes, long spaces, soft volume)
        triggerSonarPing();
        sonarInterval = setInterval(triggerSonarPing, 16000); // Trigger ping every 16 seconds
    }

    function triggerSonarPing() {
        if (!audioCtx || audioCtx.state === 'suspended') return;

        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        const lowpass = audioCtx.createBiquadFilter();

        osc.type = 'sine';
        // Warm, low sonar pitch (392Hz - G4 note) instead of sharp high frequency
        osc.frequency.setValueAtTime(392, now);
        osc.frequency.exponentialRampToValueAtTime(370, now + 1.8);

        // Filter the ping to keep it muffled under water
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(1000, now);

        // Ping volume envelope (very quiet background accent)
        gainNode.gain.setValueAtTime(0.0, now);
        gainNode.gain.linearRampToValueAtTime(0.012, now + 0.08); // Slow attack
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 4.5); // Very long, organic decay

        // Subtle echo delay effect
        const delayNode = audioCtx.createDelay();
        delayNode.delayTime.value = 0.6; // Longer echo spacing
        const delayGain = audioCtx.createGain();
        delayGain.gain.value = 0.22; // Low feedback

        osc.connect(lowpass);
        lowpass.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        // Echo loop
        gainNode.connect(delayNode);
        delayNode.connect(delayGain);
        delayGain.connect(delayNode);
        delayGain.connect(audioCtx.destination);

        osc.start(now);
        osc.stop(now + 5.0);
    }

    function triggerBubbleSynth() {
        if (!audioCtx || audioCtx.state === 'suspended') return;
        
        // Throttle bubbles to keep soundscape calm
        if (bubbleSoundTimeout) return;
        bubbleSoundTimeout = setTimeout(() => {
            bubbleSoundTimeout = null;
        }, 220); // Longer throttle interval

        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        const lowpass = audioCtx.createBiquadFilter();

        osc.type = 'sine';
        // Mellow bubble pitch sweep (220Hz to 380Hz)
        const startFreq = 200 + Math.random() * 80;
        const endFreq = startFreq * (1.5 + Math.random() * 0.5);
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.18);

        // Bubble filter to cut off harsh treble clicks
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(800, now);

        // Soft volume pop envelope
        gainNode.gain.setValueAtTime(0.006, now);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

        osc.connect(lowpass);
        lowpass.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.25);
    }

    // Toggle Audio Control
    soundToggle.addEventListener('click', () => {
        if (!audioCtx) {
            initAudio();
            isAudioPlaying = true;
            toggleSoundUI(true);
            updateAudioToCurrentZone();
        } else if (audioCtx.state === 'suspended') {
            audioCtx.resume();
            isAudioPlaying = true;
            toggleSoundUI(true);
            updateAudioToCurrentZone();
        } else if (isAudioPlaying) {
            audioCtx.suspend();
            isAudioPlaying = false;
            toggleSoundUI(false);
        } else {
            audioCtx.resume();
            isAudioPlaying = true;
            toggleSoundUI(true);
            updateAudioToCurrentZone();
        }
    });

    function updateAudioToCurrentZone() {
        if (filterNode && masterGainNode) {
            const cutoffs = [220, 180, 140, 100, 70];
            const volumes = [0.012, 0.024, 0.038, 0.052, 0.065];
            const index = currentActiveZone;
            
            filterNode.frequency.setValueAtTime(cutoffs[index], audioCtx.currentTime);
            masterGainNode.gain.setValueAtTime(volumes[index], audioCtx.currentTime);
        }
    }

    function toggleSoundUI(isPlaying) {
        if (isPlaying) {
            iconSoundOn.classList.remove('hide');
            iconSoundOff.classList.add('hide');
            soundToggle.classList.add('active');
            soundToggle.querySelector('span').textContent = 'Atmosphere On';
        } else {
            iconSoundOn.classList.add('hide');
            iconSoundOff.classList.remove('hide');
            soundToggle.classList.remove('active');
            soundToggle.querySelector('span').textContent = 'Atmosphere Off';
        }
    }
});
