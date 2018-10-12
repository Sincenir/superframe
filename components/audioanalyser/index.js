if (typeof AFRAME === 'undefined') {
  throw new Error('Component attempted to register before AFRAME was available.');
}

var audioBufferCache = {};

/**
 * Audio visualizer component for A-Frame using AnalyserNode.
 */
AFRAME.registerComponent('audioanalyser', {
  schema: {
    buffer: {default: false},
    beatDetectionDecay: {default: 0.99},
    beatDetectionMinVolume: {default: 15},
    beatDetectionThrottle: {default: 250},
    enabled: {default: true},
    enableBeatDetection: {default: true},
    enableLevels: {default: true},
    enableWaveform: {default: true},
    enableVolume: {default: true},
    fftSize: {default: 2048},
    smoothingTimeConstant: {default: 0.8},
    src: {
      parse: function (val) {
        if (val.constructor !== String) { return val; }
        if (val.startsWith('#') || val.startsWith('.')) {
          return document.querySelector(val);
        }
        return val;
      }
    },
    unique: {default: false}
  },

  init: function () {
    var analyser;
    var data = this.data;
    var gainNode

    this.audioEl = null;
    this.context = new AudioContext();
    this.levels = null;
    this.waveform = null;
    this.volume = 0;

    analyser = this.analyser = this.context.createAnalyser();
    gainNode = this.gainNode = this.context.createGain();
    gainNode.connect(analyser);
    analyser.connect(this.context.destination);
    analyser.fftSize = data.fftSize;
    analyser.smoothingTimeConstant = data.smoothingTimeConstant;
    this.levels = new Uint8Array(analyser.frequencyBinCount);
    this.waveform = new Uint8Array(analyser.fftSize);
  },

  update: function (oldData) {
    var analyser = this.analyser;
    var data = this.data;

    // Update analyser stuff.
    if (oldData.fftSize !== data.fftSize ||
        oldData.smoothingTimeConstant !== data.smoothingTimeConstant) {
      analyser.fftSize = data.fftSize;
      analyser.smoothingTimeConstant = data.smoothingTimeConstant;
      this.levels = new Uint8Array(analyser.frequencyBinCount);
      this.waveform = new Uint8Array(analyser.fftSize);
    }

    if (!data.src) { return; }
    this.refreshSource();
  },

  /**
   * Update spectrum on each frame.
   */
  tick: function (t, dt) {
    var data = this.data;
    var volume;

    if (!data.enabled) { return; }

    // Levels (frequency).
    if (data.enableLevels || data.enableVolume) {
      this.analyser.getByteFrequencyData(this.levels);
    }

    // Waveform.
    if (data.enableWaveform) {
      this.analyser.getByteTimeDomainData(this.waveform);
    }

    // Average volume.
    if (data.enableVolume || data.enableBeatDetection) {
      var sum = 0;
      for (var i = 0; i < this.levels.length; i++) {
        sum += this.levels[i];;
      }
      this.volume = sum / this.levels.length;
    }

    // Beat detection.
    if (data.enableBeatDetection) {
      volume = this.volume;
      if (!this.beatCutOff) { this.beatCutOff = volume; }
      if (volume > this.beatCutOff && volume > this.data.beatDetectionMinVolume) {
        console.log('[audioanalyser] Beat detected.');
        this.el.emit('audioanalyserbeat', null, false);
        this.beatCutOff = volume * 1.5;
        this.beatTime = 0;
      } else {
        if (this.beatTime <= this.data.beatDetectionThrottle) {
          this.beatTime += dt;
        } else {
          this.beatCutOff *= this.data.beatDetectionDecay;
          this.beatCutOff = Math.max(this.beatCutOff, this.data.beatDetectionMinVolume);
        }
      }
    }
  },

  refreshSource: function () {
    var analyser = this.analyser;
    var data = this.data;

    if (data.buffer && data.src.constructor === String) {
      this.getBufferSource().then(source => {
        this.source = source;
        this.source.connect(this.gainNode);
      });
    } else {
      this.source = this.getMediaSource();
      this.source.connect(this.gainNode);
    }
  },

  suspendContext: function () {
    this.context.suspend();
  },

  resumeContext: function () {
    this.context.resume();
  },

  /**
   * Fetch and parse buffer to audio buffer. Resolve a source.
   */
  fetchAudioBuffer: function (src) {
    return new Promise(resolve => {
      // From cache.
      if (audioBufferCache[src]) {
        return resolve(audioBufferCache[src]);
      }

      // Fetch if does not exist.
      fetch(src).then(response => {
        return response.arrayBuffer();
      }).then(buffer => {
        this.context.decodeAudioData(buffer).then(audioBuffer => {
          audioBufferCache[src] = audioBuffer;
          resolve(audioBuffer);
        });
      }).catch(console.error);
    });
  },

  getBufferSource: function () {
    var data = this.data;
    return this.fetchAudioBuffer(data.src).then(() => {
      var source;
      source = this.context.createBufferSource();
      source.buffer = audioBufferCache[data.src];
      this.el.emit('audioanalyserbuffersource', source, false);
      return source;
    }).catch(console.error);
  },

  getMediaSource: function () {
    if (this.data.src.constructor === String) {
      if (!this.audio) {
        this.audio = document.createElement('audio');
        this.audio.crossOrigin = 'anonymous';
      }
      this.audio.setAttribute('src', this.data.src);
    } else {
      this.audio = this.data.src;
    }
    return this.context.createMediaElementSource(this.audio)
  }
});
