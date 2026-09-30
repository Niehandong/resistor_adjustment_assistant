#!/bin/bash

# 配置变量
APP_NAME="resistor-frontend"
PID_FILE="frontend.pid"
LOG_FILE="frontend.log"

usage() {
    echo "Usage: $0 {start|stop|restart|status|logs}"
    exit 1
}

start() {
    if [ -f $PID_FILE ] && kill -0 $(cat $PID_FILE) 2>/dev/null; then
        echo "$APP_NAME is already running (PID: $(cat $PID_FILE))"
        return
    fi
    echo "Starting $APP_NAME..."
    # 使用 nohup 运行 npm run dev
    # 注意：vite 可能会启动子进程，这里记录的是 npm 的 PID
    nohup npm run dev > $LOG_FILE 2>&1 &
    echo $! > $PID_FILE
    echo "$APP_NAME started with PID $!"
}

stop() {
    if [ ! -f $PID_FILE ] || ! kill -0 $(cat $PID_FILE) 2>/dev/null; then
        echo "$APP_NAME is not running"
        [ -f $PID_FILE ] && rm $PID_FILE
        return
    fi
    PID=$(cat $PID_FILE)
    echo "Stopping $APP_NAME (PID: $PID) and its children..."
    
    # 杀掉进程组，确保 vite 子进程也被清理
    PGRP=$(ps -o pgid= -p $PID | tr -d ' ')
    if [ ! -z "$PGRP" ]; then
        kill -- -$PGRP
    else
        kill $PID
    fi
    
    sleep 2
    rm $PID_FILE
    echo "$APP_NAME stopped"
}

status() {
    if [ -f $PID_FILE ] && kill -0 $(cat $PID_FILE) 2>/dev/null; then
        echo "$APP_NAME is running (PID: $(cat $PID_FILE))"
    else
        echo "$APP_NAME is stopped"
    fi
}

logs() {
    tail -f $LOG_FILE
}

case "$1" in
    start) start ;;
    stop) stop ;;
    restart) stop; start ;;
    status) status ;;
    logs) logs ;;
    *) usage ;;
esac
