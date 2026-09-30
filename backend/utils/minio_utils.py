import os
import io
from minio import Minio
from dotenv import load_dotenv

load_dotenv()

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY")
MINIO_BUCKET = os.getenv("MINIO_BUCKET")
MINIO_SECURE = os.getenv("MINIO_SECURE", "False").lower() == "true"

class MinioClient:
    def __init__(self):
        self.client = Minio(
            MINIO_ENDPOINT,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
            secure=MINIO_SECURE
        )
        self._ensure_bucket()

    def _ensure_bucket(self):
        if not self.client.bucket_exists(MINIO_BUCKET):
            self.client.make_bucket(MINIO_BUCKET)

    def upload_file(self, object_name, file_path):
        self.client.fput_object(MINIO_BUCKET, object_name, file_path)
        return object_name

    def upload_fileobj(self, object_name, data, length):
        if isinstance(data, bytes):
            data = io.BytesIO(data)
        self.client.put_object(MINIO_BUCKET, object_name, data, length)
        return object_name

    def download_file(self, object_name, file_path):
        self.client.fget_object(MINIO_BUCKET, object_name, file_path)

    def get_object(self, object_name):
        return self.client.get_object(MINIO_BUCKET, object_name)

    def remove_object(self, object_name):
        self.client.remove_object(MINIO_BUCKET, object_name)

minio_client = MinioClient()
