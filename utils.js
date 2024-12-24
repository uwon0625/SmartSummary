class CommentProcessor {
    static summarizeText(text) {
        // Basic summarization (you can use more sophisticated algorithms)
        const sentences = text.split('.');
        return sentences.slice(0, 3).join('.') + '.';
    }

    static searchComments(comments, searchTerm) {
        return comments.filter(comment => 
            comment.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }
} 