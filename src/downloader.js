const ffmpeg = require('fluent-ffmpeg');
const binaries = require('ffmpeg-static');
const fs = require('fs');
const ytdl = require('ytdl-core');
const electron = require('electron');
const path = require('path');
const ID3Writer = require('browser-id3-writer');

const deezerApi = require('./deezerApi');

const startDownload = async (params, event) => {

    let info = await ytdl.getInfo(params.url);
    let title = '';

    let songDataFromDeezer;

    if (params.coverSearch)
        songDataFromDeezer = await deezerApi.getSongData(params.coverSearchTitle);

    if (songDataFromDeezer)
        title = `${songDataFromDeezer.artist} - ${songDataFromDeezer.title}`;
    else
        title = info.videoDetails.title; // use video title as file title

    let downloadPath = electron.app.getPath('downloads');

    // Given the url of the video, the path in which to store the output, and the video title
    // download the video as an audio only mp4 and write it to a temp file then return
    // the full path for the tmp file, the path in which its stored, and the title of the desired output.
    let paths = await getVideoAsMp4(params.url, downloadPath, title, event);

    // Pass the returned paths and info into the function which will convert the mp4 tmp file into
    // the desired output mp3 file.
    await convertMp4ToMp3(paths, event);

    // Remove the temp mp4 file.
    fs.unlinkSync(paths.filePath);

    // write mp3 tags to file
    if (songDataFromDeezer) {
        event.sender.send('download-status', 'Writing MP3 tags');
        await writeMp3TagsToFile(paths, songDataFromDeezer);
    }

    event.sender.send('download-status', 'Done', title);
};

const getVideoAsMp4 = (urlLink, userProvidedPath, title, event) => {
    // Tell the user we are starting to get the video.
    event.sender.send('download-status', 'Downloading...');

    return new Promise((resolve, reject) => {
        let fullPath = path.join(userProvidedPath, `tmp_${title}.mp4`);

        // Create a reference to the stream of the video being downloaded.
        let videoObject = ytdl(urlLink, {filter: 'audioonly'});

        videoObject.on('progress', (chunkLength, downloaded, total) => {
            let newVal = Math.floor((downloaded / total) * 100);
            event.sender.send('progress-status', newVal);
        });

        // Create write-able stream for the temp file and pipe the video stream into it.
        videoObject.pipe(fs.createWriteStream(fullPath)).on('finish', () => {
            setTimeout(() => {
                resolve({filePath: fullPath, folderPath: userProvidedPath, fileTitle: `${title}.mp3`});
            }, 1000);
        });
    });
};

const convertMp4ToMp3 = (paths, event) => {
    // Tell the user we are starting to convert the file to mp3.
    event.sender.send('download-status', 'Converting...');
    event.sender.send('progress-status', 0);

    return new Promise(async (resolve, reject) => {

        // Pass ffmpeg the temp mp4 file. Set the path where is ffmpeg binary for the platform. Provided desired format.
        ffmpeg(paths.filePath)
            .setFfmpegPath(binaries)
            .format('mp3')
            .audioBitrate(320)
            .on('progress', (progress) => {
                event.sender.send('download-status', `Converting... [${progress.targetSize} kB]`);
            })
            .output(fs.createWriteStream(path.join(paths.folderPath, paths.fileTitle)))
            .on('end', () => {
                event.sender.send('progress-status', 100);
                resolve();
            })
            .run();
    });
};

const writeMp3TagsToFile = async (paths, songData) => {

    let coverImage = await deezerApi.getCoverImage(songData.cover);

    const songBuffer = fs.readFileSync(path.join(paths.folderPath, paths.fileTitle));

    const writer = new ID3Writer(songBuffer);
    writer.setFrame('TIT2', songData.title)
        .setFrame('TPE1', songData.artist)
        .setFrame('TALB', songData.album)
        .setFrame('APIC', {
            type: 3,
            data: Buffer.from(coverImage.data, 'base64'),
            description: 'Front cover'
        });
    writer.addTag();

    fs.unlinkSync(path.join(paths.folderPath, paths.fileTitle));

    const taggedSongBuffer = Buffer.from(writer.arrayBuffer);
    fs.writeFileSync(path.join(paths.folderPath, paths.fileTitle), taggedSongBuffer);
};

module.exports = {
    startDownload
};