import EventEmitter from 'events';
import path from 'path';
import fs from 'fs';
import imagemin from 'imagemin';

import imageminAdvpng from 'imagemin-advpng';
import imageminOptipng from 'imagemin-optipng';
import imageminPngcrush from 'imagemin-pngcrush';
import imageminPngout from 'imagemin-pngout';
import imageminZopfli from 'imagemin-zopfli';

import imageminJpegoptim from 'imagemin-jpegoptim';
import imageminJpegtran from 'imagemin-jpegtran';
import imageminMozjpeg from 'imagemin-mozjpeg';

import imageminSvgo from 'imagemin-svgo';

import imageminGiflossy from 'imagemin-giflossy';
import imageminGifsicle from 'imagemin-gifsicle';

const isLibjpegNotFound = ex => {
    return /EPIPE/.test(ex.code)
        || /Library not loaded:.+libjpeg/.test(ex.message);
};

const engineJpg = algorithm => {
    switch (algorithm) {
        case 'jpegoptim':
            return imageminJpegoptim({
                progressive: false,
            });
        case 'jpegtran':
            return imageminJpegtran({
                progressive: true,
            });
        case 'mozjpeg':
            return imageminMozjpeg({
                quality: 90,
            });
        default:
            return null;
    }
};

const enginePng = algorithm => {
    switch (algorithm) {
        case 'advpng':
            return imageminAdvpng({
                optimizationLevel: 4,
            });
        case 'optipng':
            return imageminOptipng();
        case 'pngcrush':
            return imageminPngcrush({
                reduce: true,
            });
        case 'pngout':
            return imageminPngout();
        case 'zopfli':
            return imageminZopfli({
                transparent: true,
            });
        default:
            return null;
    }
};

const engineSvg = algorithm => {
    switch (algorithm) {
        case 'svgo':
            return imageminSvgo();
        default:
            return null;
    }
};

const engineGif = algorithm => {
    switch (algorithm) {
        case 'giflossy':
            return imageminGiflossy({
                interlaced: true,
                optimizationLevel: 3,
                optimize: 3,
            });
        case 'gifsicle':
            return imageminGifsicle({
                interlaced: true,
                optimizationLevel: 3,
            });
        default:
            return null;
    }
};

const getPlugin = (fileType, algorithm) => {
    if (/image\/jpg/.test(fileType) || /image\/jpeg/.test(fileType)) {
        return engineJpg(algorithm);
    }
    if (/image\/png/.test(fileType)) {
        return enginePng(algorithm);
    }
    if (/image\/svg/.test(fileType) || /image\/svg\+xml/.test(fileType)) {
        return engineSvg(algorithm);
    }
    if (/image\/gif/.test(fileType)) {
        return engineGif(algorithm);
    }
    return undefined;
};

class Process extends EventEmitter {

    constructor(file, algorithms, keepSource) {
        super();
        this.file = file;
        this.path = this._getPath(keepSource);
        this.originalSize = file.size;
        this.size = file.size;
        this.dir = path.resolve(file.path, '..');
        this.algorithms = algorithms;
        this.currentAlgorithm = null;
        this.finishedAlgorithms = [];
        this.finished = false;
        this.failed = false;
        this.errors = [];
        Promise.map(algorithms, this._createJob, { concurrency: 1 })
            .then(this._done)
            .catch(this._error)
            .finally(this._finish);
    }

    getFile = () => this.file;

    getSize = () => this.size;

    getOriginalSize = () => this.originalSize;

    getAlgorithms = () => [...this.algorithms];

    getCurrentAlgorithm = () => ({ ...this.currentAlgorithm });

    isFinished = () => this.finished;

    isFailed = () => this.failed;

    getErrors = () => this.errors;

    getFinishedAlgorithms = () => [...this.finishedAlgorithms];

    getSave = () => 100 - ((this.size / this.originalSize) * 100);

    _copySourceImage = () => {
        const fileExtension = path.extname(this.file.path);
        const newPath = this.file.path.replace(fileExtension, ` (1)${fileExtension}`);
        fs.copyFileSync(this.file.path, newPath);
        return newPath;
    }

    _getPath = keepSource => {
        return keepSource
            ? this.file.path
            : this._copySourceImage();
    }

    _createJob = async (algorithm, index, length) => {
        this.currentAlgorithm = { algorithm, index, length };
        this.emit('start', this.currentAlgorithm);
        const newSize = await this._compressImage(algorithm);
        if (this.size !== newSize) {
            this.finishedAlgorithms.push(algorithm);
        }
        this.size = newSize;
        this.emit('end', this.currentAlgorithm, this.size);
    }

    _compressImage = algorithm => {

        const plugin = getPlugin(this.file.type, algorithm);
        return imagemin(this.path, this.dir, {
            plugins: [plugin],
        })
            .then(file => {
                if (file) {
                    return fs.statSync(this.path).size;
                }
                throw new Error(`Invalid file name "${this.file.path}".`);
            })
            .catch(ex => {
                console.warn(ex);
                let { message } = ex;
                if (algorithm === 'jpegoptim' && isLibjpegNotFound(ex)) {
                    message = 'You probably need to install "libjpeg" on your computer.';
                }
                this.errors.push({
                    algorithm,
                    message,
                });
                this._failed(ex);
                return this.size;
            });
    }

    _done = () => {
        this.emit('done', this.size);
    }

    _failed = ex => {
        this.failed = true;
        this.emit('failed', ex);
    }

    _finish = () => {
        this.finished = true;
        this.emit('finish');
    }

}

export default Process;
