import {createLogger, transports, format} from "winston";
const {combine, timestamp, printf} = format;

const myFormat = printf(({ level, message,  timestamp }) => {
    return `[${timestamp}][${level}]: ${message}`;
});

export default createLogger({
    format: combine(
        timestamp(),
        myFormat
    ),
    transports: [
        new transports.File({
            filename: 'nyabot.log',
            handleExceptions: true
        })
    ]
});