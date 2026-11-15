class StudyError(Exception):
    """A user-facing failure with an HTTP status."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
