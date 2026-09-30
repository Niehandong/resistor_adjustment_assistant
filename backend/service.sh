#!/bin/bash

# 配置变量
APP_NAME="resistor-backend"
PID_FILE="backend.pid"
LOG_FILE="logs/app.log"
PYTHON_EXEC="../.venv/bin/python"
MAIN_FILE="main.py"

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
    nohup $PYTHON_EXEC $MAIN_FILE > /dev/null 2>&1 &
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
    echo "Stopping $APP_NAME (PID: $PID)..."
    kill $PID
    sleep 2
    if kill -0 $PID 2>/dev/null; then
        echo "Forcing stop..."
        kill -9 $PID
    fi
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
